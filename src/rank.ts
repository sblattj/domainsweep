/** Pure expansion of variants x TLDs into a ranked candidate list. */
import type { Candidate, Variant } from "./types.ts";

const TLD_RE = /^[a-z]{2,24}$/;

/**
 * Parse a user-supplied TLD list: "[com, ai,.live]", "com,ai", "com ai".
 * Lowercases, strips dots/brackets/quotes, dedupes, keeps order.
 * Empty or undefined (or nothing valid) falls back to `fallback`.
 */
export function parseTldList(raw: string | undefined, fallback: string[]): string[] {
  const cleaned = (raw ?? "").toLowerCase().replace(/[[\]'"`]/g, "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of cleaned.split(/[\s,;|]+/)) {
    const tld = piece.replace(/\./g, "").trim();
    if (!TLD_RE.test(tld) || seen.has(tld)) continue;
    seen.add(tld);
    out.push(tld);
  }
  return out.length > 0 ? out : fallback;
}

/**
 * Expand `variants` (already in tier order) across `sortKey` (TLD priority).
 *
 * Default is name-major — every TLD for a variant before moving to the next
 * variant (scryb.com, scryb.live, scryb.me, scrib.com, ...). `byTld: true`
 * flips it to TLD-major (scryb.com, scrib.com, ..., scryb.ai, ...).
 */
export function rankCandidates(
  variants: Variant[],
  sortKey: string[],
  opts: { byTld?: boolean; limit: number },
): Candidate[] {
  const limit = Math.max(0, opts.limit);
  if (limit === 0) return [];

  const seen = new Set<string>();
  const tlds = sortKey
    .map((t) => t.trim().toLowerCase().replace(/[[\]'"`.]/g, ""))
    .filter((t) => {
      if (!TLD_RE.test(t) || seen.has(t)) return false;
      seen.add(t);
      return true;
    });

  const out: Candidate[] = [];
  const emit = (v: Variant, tld: string) => {
    out.push({
      domain: `${v.name}.${tld}`,
      name: v.name,
      tld,
      tier: v.tier,
      strategy: v.strategy,
      rank: out.length,
    });
  };

  if (opts.byTld) {
    for (const tld of tlds) {
      for (const v of variants) {
        if (out.length >= limit) return out;
        emit(v, tld);
      }
    }
  } else {
    for (const v of variants) {
      for (const tld of tlds) {
        if (out.length >= limit) return out;
        emit(v, tld);
      }
    }
  }
  return out;
}
