/**
 * Optional on-disk cache of finished check results, one JSON file per domain
 * under `<cacheDir>/results/`. Off unless a caller passes `results`.
 * "unknown" is never stored: it means the lookup failed, not that it answered.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CheckResult } from "../types.ts";

export type ResultCacheMode =
  /** Serve a fresh entry, else look up and store. */
  | "use"
  /** Always look up, then store. */
  | "refresh"
  /** Never look up: serve any entry regardless of age, a miss is "unknown". */
  | "only";

export interface ResultCacheOpts {
  /** Max age of an entry in "use" mode. */
  ttlMs: number;
  mode?: ResultCacheMode;
  /** Clock override for tests. */
  now?: () => number;
}

interface Entry {
  savedAt: number;
  result: Omit<CheckResult, "ms" | "cached">;
}

export function resultFile(cacheDir: string, domain: string): string {
  const h = createHash("sha256").update(domain).digest("hex").slice(0, 24);
  return path.join(cacheDir, "results", `${h}.json`);
}

export function readResult(cacheDir: string, domain: string, opts: ResultCacheOpts): CheckResult | undefined {
  const mode = opts.mode ?? "use";
  if (mode === "refresh") return undefined;
  let e: Entry;
  try {
    e = JSON.parse(fs.readFileSync(resultFile(cacheDir, domain), "utf8")) as Entry;
  } catch {
    return undefined;
  }
  if (e.result?.domain !== domain) return undefined;
  const now = (opts.now ?? Date.now)();
  if (mode === "use" && now - e.savedAt >= opts.ttlMs) return undefined;
  return { ...e.result, ms: 0, cached: true };
}

export function writeResult(cacheDir: string, r: CheckResult, opts: ResultCacheOpts): void {
  if (r.status === "unknown") return;
  const { ms: _ms, cached: _c, ...result } = r;
  const file = resultFile(cacheDir, r.domain);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: (opts.now ?? Date.now)(), result } satisfies Entry));
    fs.renameSync(tmp, file);
  } catch {
    // A cache that cannot be written is a slower run, never a failed one.
  }
}
