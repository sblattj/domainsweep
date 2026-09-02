/**
 * Configuration loading.
 *
 * Precedence, lowest to highest:
 *   built-in defaults → ${home}/.config/domainsweep/.env → ${cwd}/.env → env (process.env)
 *
 * We parse the .env files ourselves rather than relying on Bun's automatic .env
 * loading: the CLI can be invoked from any cwd, and the home config must be
 * honored regardless of where you run it from. (Bun will also auto-load
 * ${cwd}/.env into process.env, which is harmless — both sources agree.)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Config, VariantStrategy } from "./types.ts";

/** com first, ai second, then the popular rest. */
export const DEFAULT_SORT_KEY: string[] = [
  "com",
  "ai",
  "io",
  "co",
  "app",
  "dev",
  "live",
  "me",
  "net",
  "org",
  "so",
  "sh",
  "xyz",
  "gg",
  "to",
  "us",
];

export const DEFAULT_VARIANTS: VariantStrategy[] = ["spelling", "leet", "affix", "vowel"];

/** Built-in defaults. `cacheDir` is resolved per-call against the home directory. */
export const DEFAULTS = {
  sortKey: DEFAULT_SORT_KEY,
  variants: DEFAULT_VARIANTS,
  maxVariants: 25,
  limit: 80,
  concurrency: 6,
  timeoutMs: 8000,
} as const;

const KNOWN_VARIANTS: readonly VariantStrategy[] = ["spelling", "leet", "affix", "vowel"];

/**
 * Parse a TLD priority list. Accepts "[com, ai,.live]", "com,ai" or "com ai".
 * Strips brackets, dots and quotes; lowercases; dedupes; preserves order.
 *
 * Deliberately local to config.ts so config has no dependency on rank.ts
 * (rank's `parseTldList` serves the CLI's --tlds flag).
 */
export function parseSortKey(raw: string | undefined, fallback: string[]): string[] {
  if (raw == null) return fallback;
  const stripped = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const out: string[] = [];
  for (const piece of stripped.split(/[\s,]+/)) {
    const tld = piece
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^\.+/, "")
      .toLowerCase();
    if (!tld) continue;
    if (!out.includes(tld)) out.push(tld);
  }
  return out.length ? out : fallback;
}

/** Tiny .env parser: KEY=VALUE, `#` comments, optional quotes, malformed lines ignored. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length > 1 && value.endsWith(q)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Positive integer or the fallback (NaN, <1, or non-integral text all fall back). */
function intOr(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const t = raw.trim();
  if (!/^[+-]?\d+$/.test(t)) return fallback;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function parseVariants(raw: string | undefined, fallback: VariantStrategy[]): VariantStrategy[] {
  if (raw == null) return fallback;
  const pieces = raw
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[\s,]+/)
    .map((p) => p.replace(/^["']|["']$/g, "").trim().toLowerCase())
    .filter(Boolean);
  if (!pieces.length) return fallback;

  const out: VariantStrategy[] = [];
  const unknown: string[] = [];
  let sawExact = false;
  for (const p of pieces) {
    if (p === "exact") {
      sawExact = true; // implicit; never a listed strategy
      continue;
    }
    if ((KNOWN_VARIANTS as readonly string[]).includes(p)) {
      const s = p as VariantStrategy;
      if (!out.includes(s)) out.push(s);
    } else {
      unknown.push(p);
    }
  }
  if (unknown.length) {
    console.error(
      `domainsweep: ignoring unknown DOMAIN_VARIANTS value(s): ${unknown.join(", ")} ` +
        `(known: ${KNOWN_VARIANTS.join(", ")})`,
    );
  }
  // "exact" alone is a deliberate exact-only run; an all-unknown list is a typo.
  if (!out.length && !sawExact) return fallback;
  return out;
}

export function loadConfig(opts?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  home?: string;
}): Config {
  const env = opts?.env ?? (process.env as Record<string, string | undefined>);
  const cwd = opts?.cwd ?? process.cwd();
  const home = opts?.home ?? os.homedir();

  const layered: Record<string, string | undefined> = {
    ...readEnvFile(path.join(home, ".config", "domainsweep", ".env")),
    ...readEnvFile(path.join(cwd, ".env")),
  };
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) layered[k] = v;
  }

  const get = (k: string): string | undefined => {
    const v = layered[k];
    return v === undefined || v === "" ? undefined : v;
  };

  return {
    sortKey: parseSortKey(get("DOMAIN_SORT_KEY"), [...DEFAULTS.sortKey]),
    variants: parseVariants(get("DOMAIN_VARIANTS"), [...DEFAULTS.variants]),
    maxVariants: intOr(get("DOMAIN_MAX_VARIANTS"), DEFAULTS.maxVariants),
    limit: intOr(get("DOMAIN_LIMIT"), DEFAULTS.limit),
    concurrency: intOr(get("DOMAIN_CONCURRENCY"), DEFAULTS.concurrency),
    timeoutMs: intOr(get("DOMAIN_TIMEOUT_MS"), DEFAULTS.timeoutMs),
    cacheDir: get("DOMAIN_CACHE_DIR") ?? path.join(home, ".cache", "domainsweep"),
  };
}
