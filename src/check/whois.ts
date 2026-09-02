import { createConnection } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Availability, CheckResult } from "../types.ts";

const IANA_WHOIS = "whois.iana.org";
const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Registries ban aggressive port-43 clients: at most 2 in flight per host. */
const PER_HOST_LIMIT = 2;

interface ReferralCache {
  [tld: string]: { host: string | null; at: number };
}

let memo: ReferralCache | null = null;
let memoLoaded = false;

/** tld -> port-43 host, from IANA's referral line. Null when there is none. */
export async function whoisServerFor(
  tld: string,
  cacheDir: string,
  timeoutMs: number,
): Promise<string | null> {
  const key = tld.toLowerCase().replace(/^\./, "");
  const file = join(cacheDir, "whois-servers.json");
  if (!memoLoaded) {
    memo = await readCache(file);
    memoLoaded = true;
  }
  const hit = memo?.[key];
  if (hit && Date.now() - hit.at < REFERRAL_TTL_MS) return hit.host;

  let host: string | null = null;
  try {
    const text = await whoisQuery(IANA_WHOIS, key, timeoutMs);
    const m = text.match(/^whois:\s*(\S+)\s*$/im);
    host = m ? m[1]!.toLowerCase() : null;
  } catch {
    return hit?.host ?? null; // stale beats a network blip
  }

  memo = { ...(memo ?? {}), [key]: { host, at: Date.now() } };
  await mkdir(cacheDir, { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify(memo, null, 2), "utf8").catch(() => {});
  return host;
}

/** Test/CLI hook: forget the in-process referral memo. */
export function resetWhoisMemo(): void {
  memo = null;
  memoLoaded = false;
}

async function readCache(file: string): Promise<ReferralCache> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as ReferralCache;
  } catch {
    return {};
  }
}

/** Raw port-43 query. Rejects on timeout or socket error. */
export async function whoisQuery(host: string, query: string, timeoutMs: number): Promise<string> {
  return withHostSlot(host, () =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const socket = createConnection({ host, port: 43 });
      socket.setTimeout(timeoutMs);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(Buffer.concat(chunks).toString("utf8"));
      };

      socket.on("connect", () => socket.write(`${query}\r\n`));
      socket.on("data", (d: Buffer) => chunks.push(d));
      socket.on("end", finish);
      socket.on("close", finish);
      socket.on("timeout", () => fail(new Error(`whois: timeout after ${timeoutMs}ms`)));
      socket.on("error", (e: Error) => fail(e));
    }),
  );
}

const hostQueues = new Map<string, { active: number; waiters: (() => void)[] }>();

async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  let q = hostQueues.get(host);
  if (!q) {
    q = { active: 0, waiters: [] };
    hostQueues.set(host, q);
  }
  if (q.active >= PER_HOST_LIMIT) {
    await new Promise<void>((r) => q!.waiters.push(r));
  }
  q.active++;
  try {
    return await fn();
  } finally {
    q.active--;
    const next = q.waiters.shift();
    if (next) next();
  }
}

/**
 * A name that is dropping / in a registry backorder auction / in redemption
 * is neither free nor plainly taken: you cannot register it today, but it may
 * come back. Checked FIRST because the Identity Digital wording ("is currently
 * available for application via the ... Dropzone service", seen live for
 * scryb.io 2026-09-02) would otherwise be read as available.
 */
const DROPPING_PATTERNS: RegExp[] = [
  /available for application via .*dropzone/i,
  /pending ?delete/i,
  /redemption ?period/i,
  /status:\s*(pendingdelete|redemptionperiod)/i,
];

const NOT_FOUND_PATTERNS: RegExp[] = [
  /domain not found/i,
  /^not found\s*$/im,
  /no match/i,
  /no data found/i,
  /no object found/i,
  /does not exist/i,
  /no entries found/i,
  /is available for/i,
  /status:\s*(free|available)/i,
  /not registered/i,
];

const TAKEN_PATTERNS: RegExp[] = [
  /^\s*domain name:/im,
  /^\s*domain status:/im,
  /^\s*registrar:/im,
  /^\s*registration status:/im,
  /^\s*creat(ed|ion date)/im,
];

const RATE_LIMIT = /rate limit|too many|quota|exceeded/i;

/**
 * Pure parser. NOT-FOUND is checked FIRST on purpose: a free .so response
 * still contains a "Domain Name:" line, so a taken-pattern-first order would
 * report every free .so as taken.
 */
export function classifyWhois(text: string): { status: Availability; detail: string } {
  for (const re of DROPPING_PATTERNS) {
    if (re.test(text)) {
      return { status: "unknown", detail: "whois: dropping (backorder/auction), not registrable today" };
    }
  }
  for (const re of NOT_FOUND_PATTERNS) {
    const m = text.match(re);
    if (m) return { status: "available", detail: trim(`whois: ${m[0].trim()}`) };
  }
  for (const re of TAKEN_PATTERNS) {
    const m = text.match(re);
    if (m) return { status: "taken", detail: trim(`whois: ${m[0].trim()}`) };
  }
  // Rate-limit detection runs LAST, and only over the head of the response.
  // Verified 2026-09-02: whois.nic.io's Terms-of-Use boilerplate contains
  // "too many queries" and "throttled" on EVERY response, so scanning the
  // whole body first reported every free .io as rate limited.
  if (RATE_LIMIT.test(head(text))) return { status: "unknown", detail: "whois: rate limited" };
  return { status: "unknown", detail: trim(`whois: ${firstMeaningfulLine(text)}`) };
}

/** First few meaningful lines — where a real error/limit message lives. */
function head(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(">>>")) continue;
    lines.push(line);
    if (lines.length >= 5) break;
  }
  return lines.join("\n");
}

function firstMeaningfulLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%") || line.startsWith("#") || line.startsWith(">>>")) continue;
    return line;
  }
  return "no response";
}

const trim = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s);

export async function whoisCheck(
  domain: string,
  cacheDir: string,
  timeoutMs: number,
): Promise<CheckResult> {
  const started = Date.now();
  const tld = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  const done = (status: Availability, detail: string): CheckResult => ({
    domain,
    status,
    method: "whois",
    detail,
    ms: Date.now() - started,
  });

  let host: string | null;
  try {
    host = await whoisServerFor(tld, cacheDir, timeoutMs);
  } catch (err) {
    return done("unknown", `whois: ${msgOf(err)}`);
  }
  if (!host) return done("unknown", `whois: no server for .${tld}`);

  try {
    const text = await whoisQuery(host, domain, timeoutMs);
    const c = classifyWhois(text);
    return done(c.status, c.detail);
  } catch (err) {
    return done("unknown", `whois: ${msgOf(err)}`);
  }
}

const msgOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
