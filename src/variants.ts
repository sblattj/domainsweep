/**
 * Pure, network-free variant generation.
 *
 * `generateVariants` returns the exact name first (tier 0), then each enabled
 * strategy in the order given by `cfg.variants` — the strategy's 1-based
 * position in that list is its tier. Output is deduped by name, invalid DNS
 * labels are dropped, and the non-exact variants are capped at
 * `cfg.maxVariants`.
 */
import type { Config, Variant, VariantStrategy } from "./types.ts";

/**
 * `y` counts as a vowel here: it is the only way the canonical example works
 * (scryb -> scrb drops the y), and "scryb" has no other vowel to drop.
 */
const VOWELS = ["a", "e", "i", "o", "u", "y"] as const;

/** A generated name plus the short human note explaining the edit. */
interface Edit {
  name: string;
  note: string;
}

/* ------------------------------------------------------------------ *
 * normalization + validation
 * ------------------------------------------------------------------ */

/**
 * Lowercase, drop a TLD the user typed ("scryb.com" -> "scryb"), strip
 * whitespace and any character outside [a-z0-9-].
 */
export function normalizeName(input: string): string {
  const lower = (input ?? "").trim().toLowerCase();
  const label = lower.includes(".") ? lower.slice(0, lower.indexOf(".")) : lower;
  return label.replace(/[^a-z0-9-]/g, "");
}

/** A usable DNS label: non-empty, <=63 chars, [a-z0-9-], no edge hyphen. */
function isValidLabel(name: string): boolean {
  if (name.length === 0 || name.length > 63) return false;
  if (name.startsWith("-") || name.endsWith("-")) return false;
  return /^[a-z0-9-]+$/.test(name);
}

/* ------------------------------------------------------------------ *
 * spelling
 * ------------------------------------------------------------------ */

/** One substitution rule, applied at each matching position separately. */
interface SubRule {
  from: string;
  to: string;
}

const SUB_RULES: SubRule[] = [
  { from: "y", to: "i" },
  { from: "i", to: "y" },
  { from: "ie", to: "y" },
  { from: "y", to: "ie" },
  { from: "ph", to: "f" },
  { from: "f", to: "ph" },
  { from: "ck", to: "k" },
  { from: "c", to: "k" },
  { from: "k", to: "c" },
  { from: "q", to: "k" },
  { from: "x", to: "ks" },
  { from: "z", to: "s" },
  { from: "s", to: "z" },
  { from: "ee", to: "ea" },
  { from: "ea", to: "ee" },
  { from: "oo", to: "u" },
];

/** Every single-position application of `rule` to `name`. */
function applySubEverywhere(name: string, rule: SubRule): Edit[] {
  const out: Edit[] = [];
  for (let i = 0; i + rule.from.length <= name.length; i++) {
    if (name.slice(i, i + rule.from.length) !== rule.from) continue;
    out.push({
      name: name.slice(0, i) + rule.to + name.slice(i + rule.from.length),
      note: `${rule.from}→${rule.to}`,
    });
  }
  return out;
}

/** Edits that are anchored to the end of the word rather than positional. */
function endEdits(name: string): Edit[] {
  const out: Edit[] = [];
  const last = name.at(-1);

  if (last === "e") out.push({ name: name.slice(0, -1), note: "-e" });
  else out.push({ name: `${name}e`, note: "+e" });

  if (last === "s") out.push({ name: name.slice(0, -1), note: "-s" });
  else out.push({ name: `${name}s`, note: "+s" });

  if (name.endsWith("er")) out.push({ name: `${name.slice(0, -2)}r`, note: "er→r" });

  if (last && !(VOWELS as readonly string[]).includes(last) && /[a-z]/.test(last)) {
    out.push({ name: name + last, note: `double ${last}` });
  }
  return out;
}

/** Collapse each doubled letter run: "buffer" -> "bufer". */
function collapseDoubles(name: string): Edit[] {
  const out: Edit[] = [];
  for (let i = 0; i + 1 < name.length; i++) {
    if (name[i] !== name[i + 1]) continue;
    out.push({ name: name.slice(0, i) + name.slice(i + 1), note: `-${name[i]}${name[i]}` });
  }
  return out;
}

/** All single-edit spelling variants of `name`, closest-looking first. */
function spellingEdits(name: string): Edit[] {
  const out: Edit[] = [];
  for (const rule of SUB_RULES) out.push(...applySubEverywhere(name, rule));
  out.push(...collapseDoubles(name));
  out.push(...endEdits(name));
  return out;
}

/* ------------------------------------------------------------------ *
 * leet
 * ------------------------------------------------------------------ */

/** `y` is an i-shaped vowel here, so scryb -> scr1b. */
const LEET: Record<string, string> = {
  i: "1",
  y: "1",
  l: "1",
  e: "3",
  a: "4",
  o: "0",
  s: "5",
  t: "7",
};

/** Single-character digit swaps, one position per output. */
function leetEdits(name: string): Edit[] {
  const out: Edit[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    const digit = LEET[ch];
    if (!digit) continue;
    out.push({ name: name.slice(0, i) + digit + name.slice(i + 1), note: `${ch}→${digit}` });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * affix
 * ------------------------------------------------------------------ */

const PREFIXES = ["get", "try", "use", "my", "hey", "go"];
const SUFFIXES = ["app", "hq", "ai", "labs", "ly", "ify", "io", "hub"];

function affixEdits(name: string): Edit[] {
  return [
    ...PREFIXES.map((p) => ({ name: p + name, note: `+${p}` })),
    ...SUFFIXES.map((s) => ({ name: name + s, note: `+${s}` })),
  ];
}

/* ------------------------------------------------------------------ *
 * vowel
 * ------------------------------------------------------------------ */

function vowelEdits(name: string): Edit[] {
  const out: Edit[] = [];

  const stripped = name.replace(/[aeiouy]/g, "");
  if (stripped !== name) out.push({ name: stripped, note: "-vowels" });

  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (!(VOWELS as readonly string[]).includes(ch)) continue;
    out.push({ name: name.slice(0, i) + name.slice(i + 1), note: `-${ch}` });
  }

  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (!(VOWELS as readonly string[]).includes(ch)) continue;
    for (const v of VOWELS) {
      if (v === ch) continue;
      out.push({ name: name.slice(0, i) + v + name.slice(i + 1), note: `${ch}→${v}` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * assembly
 * ------------------------------------------------------------------ */

export function generateVariants(
  name: string,
  cfg: Pick<Config, "variants" | "maxVariants">,
): Variant[] {
  const exact = normalizeName(name);
  if (!isValidLabel(exact)) return [];

  const out: Variant[] = [{ name: exact, tier: 0, strategy: "exact" }];
  const seen = new Set<string>([exact]);
  const max = Math.max(0, cfg.maxVariants);

  // Non-exact variants, grouped by strategy so the cap can be shared out
  // round-robin — a straight tier-order truncation would let one prolific
  // strategy (spelling) starve every later one. `extras` holds the
  // furthest-out edits (double spelling swaps) and is only drawn on once
  // every strategy group is exhausted.
  const groups: Variant[][] = cfg.variants.map(() => []);
  const extras: Variant[] = [];

  const push = (into: Variant[], edit: Edit, tier: number, strategy: VariantStrategy) => {
    if (seen.has(edit.name) || !isValidLabel(edit.name)) return;
    seen.add(edit.name);
    into.push({ name: edit.name, tier, strategy, note: edit.note });
  };

  // Spelling variants are needed by the leet pass even when spelling is
  // disabled for OUTPUT, so compute them once up front.
  const singleSpelling = spellingEdits(exact);
  const spellingOn = cfg.variants.includes("spelling");

  for (const [index, strategy] of cfg.variants.entries()) {
    const tier = index + 1;
    const ranked = groups[index]!;
    switch (strategy) {
      case "exact":
        break;
      case "spelling": {
        for (const e of singleSpelling) push(ranked, e, tier, "spelling");
        // Second pass: two spelling swaps combined.
        for (const first of singleSpelling) {
          if (!isValidLabel(first.name)) continue;
          for (const second of spellingEdits(first.name)) {
            push(extras, { name: second.name, note: `${first.note}, ${second.note}` }, tier, "spelling");
          }
        }
        break;
      }
      case "leet": {
        const bases: string[] = [exact];
        if (spellingOn) {
          for (const e of singleSpelling) if (isValidLabel(e.name)) bases.push(e.name);
        }
        for (const base of bases) for (const e of leetEdits(base)) push(ranked, e, tier, "leet");
        break;
      }
      case "affix":
        for (const e of affixEdits(exact)) push(ranked, e, tier, "affix");
        break;
      case "vowel":
        for (const e of vowelEdits(exact)) push(ranked, e, tier, "vowel");
        break;
    }
  }

  // Round-robin across the strategy groups until the cap is full.
  const nonExact: Variant[] = [];
  for (let depth = 0; nonExact.length < max; depth++) {
    let drew = false;
    for (const group of groups) {
      if (nonExact.length >= max) break;
      const v = group[depth];
      if (!v) continue;
      nonExact.push(v);
      drew = true;
    }
    if (!drew) break;
  }
  for (const v of extras) {
    if (nonExact.length >= max) break;
    nonExact.push(v);
  }

  nonExact.sort((a, b) => a.tier - b.tier);
  out.push(...nonExact);
  return out;
}
