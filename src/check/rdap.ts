import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CheckResult } from "../types.ts";

const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BACKOFF_MS = [500, 1500, 3000];

let memo: Map<string, string[]> | null = null;
let memoInflight: Promise<Map<string, string[]>> | null = null;

interface BootstrapDoc {
  services?: [string[], string[]][];
}

/**
 * IANA's RDAP bootstrap: tld -> base URLs. Cached on disk for 7 days and
 * memoized per process. A stale cache is preferred over a failed fetch.
 * NOTE: rdap.org is deliberately NOT used — it answers 404 for any TLD it
 * does not know, which is indistinguishable from "domain is free".
 */
export async function loadBootstrap(cacheDir: string, timeoutMs: number): Promise<Map<string, string[]>> {
  if (memo) return memo;
  if (memoInflight) return memoInflight;
  memoInflight = (async () => {
    const file = join(cacheDir, "rdap-dns.json");
    await mkdir(cacheDir, { recursive: true }).catch(() => {});

    let cachedText: string | null = null;
    let fresh = false;
    try {
      const st = await stat(file);
      cachedText = await readFile(file, "utf8");
      fresh = Date.now() - st.mtimeMs < BOOTSTRAP_TTL_MS;
    } catch {
      /* no cache */
    }
    if (cachedText && fresh) {
      const parsed = parseBootstrap(cachedText);
      if (parsed) return (memo = parsed);
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(IANA_BOOTSTRAP_URL, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`bootstrap ${res.status}`);
        const text = await res.text();
        const parsed = parseBootstrap(text);
        if (!parsed) throw new Error("bootstrap: unparseable");
        await writeFile(file, text, "utf8").catch(() => {});
        return (memo = parsed);
      } finally {
        clearTimeout(t);
      }
    } catch {
      if (cachedText) {
        const parsed = parseBootstrap(cachedText);
        if (parsed) return (memo = parsed); // stale beats nothing
      }
      return (memo = new Map());
    }
  })();
  try {
    return await memoInflight;
  } finally {
    memoInflight = null;
  }
}

/** Test/CLI hook: forget the in-process bootstrap memo. */
export function resetBootstrapMemo(): void {
  memo = null;
  memoInflight = null;
}

function parseBootstrap(text: string): Map<string, string[]> | null {
  let doc: BootstrapDoc;
  try {
    doc = JSON.parse(text) as BootstrapDoc;
  } catch {
    return null;
  }
  if (!Array.isArray(doc.services)) return null;
  const map = new Map<string, string[]>();
  for (const entry of doc.services) {
    const [tlds, urls] = entry;
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
    for (const raw of tlds) {
      const tld = String(raw).toLowerCase().replace(/^\./, "");
      if (!tld) continue;
      map.set(tld, urls.map(String));
    }
  }
  return map;
}

export interface RdapOpts {
  /** Backoff schedule per retry; length also bounds the attempt count. */
  backoffMs?: number[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Returns null when the TLD has no RDAP server at all, so the ladder can fall
 * through to WHOIS. Never throws.
 */
export async function rdapCheck(
  domain: string,
  bootstrap: Map<string, string[]>,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  opts: RdapOpts = {},
): Promise<CheckResult | null> {
  const started = Date.now();
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  const bases = bootstrap.get(tld);
  if (!bases || bases.length === 0) return null;

  const base = bases[0]!.endsWith("/") ? bases[0]! : `${bases[0]!}/`;
  const url = `${base}domain/${domain}`;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxTries = Math.max(1, backoff.length);

  const done = (status: CheckResult["status"], detail: string): CheckResult => ({
    domain,
    status,
    method: "rdap",
    detail,
    ms: Date.now() - started,
  });

  let lastDetail = "rdap: no attempt";
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/rdap+json" },
        redirect: "follow",
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return done("unknown", `rdap: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 200) return done("taken", "rdap 200");
    if (res.status === 404) {
      const extra = await errorBody(res);
      return done("available", `rdap 404${extra}`);
    }
    if (res.status === 429 || res.status >= 500) {
      lastDetail = `rdap ${res.status} after ${attempt + 1} tries`;
      if (attempt === maxTries - 1) break;
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      await sleep(retryAfter ?? backoff[attempt] ?? 500);
      continue;
    }
    const extra = await errorBody(res);
    return done("unknown", `rdap ${res.status}${extra}`);
  }
  return done("unknown", lastDetail);
}

async function errorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errorCode?: unknown; title?: unknown };
    const parts: string[] = [];
    if (body?.errorCode !== undefined) parts.push(String(body.errorCode));
    if (body?.title) parts.push(String(body.title));
    return parts.length ? ` (${parts.join(" ")})` : "";
  } catch {
    return "";
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return Math.max(0, Math.min(secs * 1000, 10000));
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 10000));
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
