/** Public API. */
export type {
  Availability,
  Candidate,
  CheckMethod,
  CheckResult,
  Checker,
  Config,
  Variant,
  VariantStrategy,
} from "./types.ts";

export { DEFAULTS, DEFAULT_SORT_KEY, DEFAULT_VARIANTS, loadConfig } from "./config.ts";
export { generateVariants, normalizeName } from "./variants.ts";
export { parseTldList, rankCandidates } from "./rank.ts";
export { checkAll, createChecker } from "./check/index.ts";

import type { Candidate, CheckResult, Config } from "./types.ts";
import { loadConfig } from "./config.ts";
import { generateVariants, normalizeName } from "./variants.ts";
import { rankCandidates } from "./rank.ts";
import { checkAll, createChecker } from "./check/index.ts";

export interface HuntOverrides extends Partial<Config> {
  /** TLD-major order (all .com first) instead of name-major. */
  byTld?: boolean;
  /** Stop the run once this many available domains have been found. */
  stopAfterAvailable?: number;
  /** Called in rank order as each result lands. */
  onResult?: (c: Candidate, r: CheckResult) => void;
}

/**
 * Convenience one-shot: generate variants for `name`, rank them, check them all,
 * and return the ranked candidates joined to their check results.
 */
export async function hunt(
  name: string,
  overrides: HuntOverrides = {},
): Promise<Array<Candidate & CheckResult>> {
  const { byTld, stopAfterAvailable, onResult, ...cfgOverrides } = overrides;
  const cfg: Config = { ...loadConfig(), ...cfgOverrides };

  const label = normalizeName(name);
  const variants = generateVariants(label, { variants: cfg.variants, maxVariants: cfg.maxVariants });
  const candidates = rankCandidates(variants, cfg.sortKey, { byTld, limit: cfg.limit });

  const checker = createChecker({ timeoutMs: cfg.timeoutMs, cacheDir: cfg.cacheDir });
  const byDomain = new Map(candidates.map((c) => [c.domain, c]));
  const merged: Array<Candidate & CheckResult> = [];

  await checkAll(candidates, checker, {
    concurrency: cfg.concurrency,
    stopAfterAvailable,
    onResult: (c, r) => {
      merged.push({ ...(byDomain.get(c.domain) ?? c), ...r });
      onResult?.(c, r);
    },
  });

  return merged;
}
