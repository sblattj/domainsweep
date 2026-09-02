/** Shared contracts between variants, ranking, checking, config, and the CLI. */

/** Which generation strategy produced a variant. Tier 0 is the exact name. */
export type VariantStrategy = "exact" | "spelling" | "leet" | "affix" | "vowel";

export interface Variant {
  /** The bare label, lowercase, no TLD. e.g. "scrib" */
  name: string;
  /** 0 = exact; higher = further from the input. Drives ranking. */
  tier: number;
  strategy: VariantStrategy;
  /** Human-readable note, e.g. "y→i". */
  note?: string;
}

export interface Candidate {
  domain: string; // "scrib.com"
  name: string; // "scrib"
  tld: string; // "com"
  tier: number;
  strategy: VariantStrategy;
  /** Position in the final ranked list, 0-based. */
  rank: number;
}

export type Availability = "available" | "taken" | "unknown";
export type CheckMethod = "dns" | "rdap" | "whois";

export interface CheckResult {
  domain: string;
  status: Availability;
  /** Which lookup decided the status (or the last one attempted for unknown). */
  method: CheckMethod;
  /** Free-text reason: "rdap 404", "whois: Domain not found.", "rdap 429 after 3 tries", ... */
  detail: string;
  ms: number;
}

export interface Config {
  /** TLD priority, lowercase, no dots, in order. */
  sortKey: string[];
  /** Strategies enabled for variant generation, in tier order. "exact" is always on. */
  variants: VariantStrategy[];
  /** Max variants (excluding exact) to expand into candidates. */
  maxVariants: number;
  /** Max domains to check per run. */
  limit: number;
  concurrency: number;
  timeoutMs: number;
  /** Directory for the IANA bootstrap + WHOIS referral caches. */
  cacheDir: string;
}

export interface Checker {
  /** Never throws: an error becomes status "unknown" with the reason in detail. */
  check(domain: string): Promise<CheckResult>;
}
