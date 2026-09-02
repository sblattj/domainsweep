import type { Candidate, CheckResult, Checker, Config } from "../types.ts";
import { dnsTaken } from "./dns.ts";
import { loadBootstrap, rdapCheck } from "./rdap.ts";
import { whoisCheck } from "./whois.ts";

export { dnsTaken } from "./dns.ts";
export { loadBootstrap, rdapCheck, resetBootstrapMemo } from "./rdap.ts";
export { classifyWhois, whoisCheck, whoisQuery, whoisServerFor, resetWhoisMemo } from "./whois.ts";

/**
 * Ladder: DNS (fast TAKEN short-circuit only) -> RDAP (authoritative where a
 * server exists) -> WHOIS port 43. Never throws; every failure is "unknown".
 */
export function createChecker(cfg: Pick<Config, "timeoutMs" | "cacheDir">): Checker {
  const { timeoutMs, cacheDir } = cfg;
  return {
    async check(domain: string): Promise<CheckResult> {
      const started = Date.now();
      const stamp = (r: Omit<CheckResult, "ms">): CheckResult => ({ ...r, ms: Date.now() - started });
      try {
        const dns = await dnsTaken(domain, timeoutMs);
        if (dns.taken) {
          return stamp({ domain, status: "taken", method: "dns", detail: dns.detail });
        }

        let bootstrap: Map<string, string[]>;
        try {
          bootstrap = await loadBootstrap(cacheDir, timeoutMs);
        } catch {
          bootstrap = new Map();
        }
        const rdap = await rdapCheck(domain, bootstrap, timeoutMs);
        if (rdap) return { ...rdap, ms: Date.now() - started };

        const whois = await whoisCheck(domain, cacheDir, timeoutMs);
        return { ...whois, ms: Date.now() - started };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return stamp({ domain, status: "unknown", method: "dns", detail: `check: ${msg}` });
      }
    },
  };
}

export interface CheckAllOpts {
  concurrency: number;
  /** Stop dispatching once this many "available" results have been EMITTED. */
  stopAfterAvailable?: number;
  onResult?: (c: Candidate, r: CheckResult) => void;
}

/**
 * Worker pool that pulls candidates in rank order and emits results STRICTLY
 * in rank order: a completion for rank 5 is buffered until 0..4 are emitted.
 * In-flight lookups past an early stop may finish, but are never emitted.
 */
export async function checkAll(
  candidates: Candidate[],
  checker: Checker,
  opts: CheckAllOpts,
): Promise<CheckResult[]> {
  const list = [...candidates].sort((a, b) => a.rank - b.rank);
  if (list.length === 0) return [];

  const width = Math.max(1, Math.floor(opts.concurrency));
  const buffer = new Map<number, CheckResult>(); // index in `list` -> result
  const emitted: CheckResult[] = [];
  let nextToDispatch = 0;
  let nextToEmit = 0;
  let availableEmitted = 0;
  let stopped = false;

  const drain = () => {
    while (!stopped && buffer.has(nextToEmit)) {
      const r = buffer.get(nextToEmit)!;
      buffer.delete(nextToEmit);
      emitted.push(r);
      opts.onResult?.(list[nextToEmit]!, r);
      nextToEmit++;
      if (r.status === "available") {
        availableEmitted++;
        if (opts.stopAfterAvailable !== undefined && availableEmitted >= opts.stopAfterAvailable) {
          stopped = true;
          return;
        }
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const i = nextToDispatch;
      if (i >= list.length) return;
      nextToDispatch++;
      const c = list[i]!;
      let r: CheckResult;
      try {
        r = await checker.check(c.domain);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        r = { domain: c.domain, status: "unknown", method: "dns", detail: `check: ${msg}`, ms: 0 };
      }
      if (stopped) return;
      buffer.set(i, r);
      drain();
    }
  };

  await Promise.all(Array.from({ length: Math.min(width, list.length) }, () => worker()));
  return emitted;
}
