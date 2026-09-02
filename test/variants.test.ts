import { describe, expect, test } from "bun:test";
import { generateVariants, normalizeName } from "../src/variants.ts";
import type { Config, VariantStrategy } from "../src/types.ts";

const cfg = (
  variants: VariantStrategy[],
  maxVariants = 40,
): Pick<Config, "variants" | "maxVariants"> => ({ variants, maxVariants });

const ALL: VariantStrategy[] = ["spelling", "leet", "affix", "vowel"];

describe("normalizeName", () => {
  test("lowercases and strips a typed TLD", () => {
    expect(normalizeName("Scryb.com")).toBe("scryb");
    expect(normalizeName("SCRYB.CO.UK")).toBe("scryb");
  });

  test("strips whitespace and invalid characters, keeps [a-z0-9-]", () => {
    expect(normalizeName("  Scr yb!  ")).toBe("scryb");
    expect(normalizeName("my_name-2")).toBe("myname-2");
  });

  test("leaves a bare name alone", () => {
    expect(normalizeName("scryb")).toBe("scryb");
  });
});

describe("generateVariants", () => {
  test("exact is always first with tier 0", () => {
    const out = generateVariants("scryb", cfg(ALL));
    expect(out[0]).toMatchObject({ name: "scryb", tier: 0, strategy: "exact" });
  });

  test("produces the expected lookalikes for scryb", () => {
    const out = generateVariants("scryb", cfg(ALL));
    const names = out.map((v) => v.name);
    expect(names).toContain("scrib"); // spelling y->i
    expect(names).toContain("scr1b"); // leet, via the scrib spelling variant
    expect(names).toContain("getscryb"); // affix prefix
    expect(names).toContain("scrybapp"); // affix suffix
    expect(names).toContain("scrb"); // vowel drop-all
  });

  test("strategies carry the right strategy tag", () => {
    const out = generateVariants("scryb", cfg(ALL));
    const by = (n: string) => out.find((v) => v.name === n)!;
    expect(by("scrib").strategy).toBe("spelling");
    expect(by("scr1b").strategy).toBe("leet");
    expect(by("getscryb").strategy).toBe("affix");
    expect(by("scrb").strategy).toBe("vowel");
  });

  test("every variant has a note and no variant repeats the exact name", () => {
    const out = generateVariants("scryb", cfg(ALL));
    for (const v of out.slice(1)) {
      expect(v.name).not.toBe("scryb");
      expect(typeof v.note).toBe("string");
      expect(v.note!.length).toBeGreaterThan(0);
    }
  });

  test("dedupes by name, first occurrence wins", () => {
    const out = generateVariants("scryb", cfg(ALL));
    const names = out.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("tier follows the 1-based position in cfg.variants", () => {
    const a = generateVariants("scryb", cfg(["spelling", "leet", "affix", "vowel"]));
    expect(a.find((v) => v.strategy === "spelling")!.tier).toBe(1);
    expect(a.find((v) => v.strategy === "leet")!.tier).toBe(2);
    expect(a.find((v) => v.strategy === "affix")!.tier).toBe(3);
    expect(a.find((v) => v.strategy === "vowel")!.tier).toBe(4);

    const b = generateVariants("scryb", cfg(["affix", "spelling"]));
    expect(b.find((v) => v.strategy === "affix")!.tier).toBe(1);
    expect(b.find((v) => v.strategy === "spelling")!.tier).toBe(2);
  });

  test("output is ordered by tier", () => {
    const out = generateVariants("scryb", cfg(ALL));
    const tiers = out.map((v) => v.tier);
    expect([...tiers].sort((x, y) => x - y)).toEqual(tiers);
  });

  test("disabling a strategy removes its outputs", () => {
    const out = generateVariants("scryb", cfg(["spelling"]));
    expect(out.some((v) => v.strategy === "affix")).toBe(false);
    expect(out.some((v) => v.strategy === "vowel")).toBe(false);
    expect(out.map((v) => v.name)).not.toContain("getscryb");
    expect(out.map((v) => v.name)).toContain("scrib");
  });

  test("no strategies at all yields just the exact name", () => {
    expect(generateVariants("scryb", cfg([]))).toEqual([
      { name: "scryb", tier: 0, strategy: "exact" },
    ]);
  });

  test("respects maxVariants on the NON-exact variants", () => {
    const out = generateVariants("scryb", cfg(ALL, 5));
    expect(out.length).toBe(6); // exact + 5
    expect(out[0]!.name).toBe("scryb");
    const zero = generateVariants("scryb", cfg(ALL, 0));
    expect(zero.length).toBe(1);
  });

  test("drops invalid labels (no leading/trailing hyphen, no empty, <=63 chars)", () => {
    const out = generateVariants("a-b", cfg(ALL));
    for (const v of out) {
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.name.length).toBeLessThanOrEqual(63);
      expect(v.name.startsWith("-")).toBe(false);
      expect(v.name.endsWith("-")).toBe(false);
      expect(/^[a-z0-9-]+$/.test(v.name)).toBe(true);
    }
  });

  test("leet swaps single characters only", () => {
    const out = generateVariants("aloe", cfg(["leet"]));
    const names = out.map((v) => v.name);
    expect(names).toContain("4loe");
    expect(names).toContain("al0e");
    expect(names).toContain("alo3");
    expect(names).not.toContain("4l03");
  });

  test("spelling covers the trailing-e pair both directions", () => {
    expect(generateVariants("scrybe", cfg(["spelling"])).map((v) => v.name)).toContain("scryb");
    expect(generateVariants("scryb", cfg(["spelling"])).map((v) => v.name)).toContain("scrybe");
  });

  test("vowel strategy drops all vowels and swaps one vowel", () => {
    const names = generateVariants("bota", cfg(["vowel"])).map((v) => v.name);
    expect(names).toContain("bt"); // -vowels
    expect(names).toContain("bta"); // drop one vowel
    expect(names).toContain("bote"); // swap a vowel
  });
});
