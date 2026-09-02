import { describe, expect, test } from "bun:test";
import { parseTldList, rankCandidates } from "../src/rank.ts";
import type { Variant } from "../src/types.ts";

const V: Variant[] = [
  { name: "scryb", tier: 0, strategy: "exact" },
  { name: "scrib", tier: 1, strategy: "spelling", note: "y→i" },
];

describe("parseTldList", () => {
  test("bracketed with spaces and dots", () => {
    expect(parseTldList("[com, ai,.live]", ["x"])).toEqual(["com", "ai", "live"]);
  });

  test("bare comma list", () => {
    expect(parseTldList("com,ai", ["x"])).toEqual(["com", "ai"]);
  });

  test("space separated", () => {
    expect(parseTldList("com ai", ["x"])).toEqual(["com", "ai"]);
  });

  test("dotted and quoted", () => {
    expect(parseTldList('".com", "AI"', ["x"])).toEqual(["com", "ai"]);
  });

  test("dedupes and keeps order", () => {
    expect(parseTldList("com, ai, com, live", ["x"])).toEqual(["com", "ai", "live"]);
  });

  test("empty / undefined / punctuation-only falls back", () => {
    expect(parseTldList(undefined, ["com"])).toEqual(["com"]);
    expect(parseTldList("", ["com"])).toEqual(["com"]);
    expect(parseTldList("   ", ["com"])).toEqual(["com"]);
    expect(parseTldList("[]", ["com"])).toEqual(["com"]);
  });

  test("drops entries that are not valid TLD labels", () => {
    expect(parseTldList("com, 1, a, x9y", ["fallback"])).toEqual(["com"]);
  });
});

describe("rankCandidates", () => {
  test("name-major order matches the user's example", () => {
    const out = rankCandidates(V, ["com", "live", "me"], { limit: 10 });
    expect(out.map((c) => c.domain)).toEqual([
      "scryb.com",
      "scryb.live",
      "scryb.me",
      "scrib.com",
      "scrib.live",
      "scrib.me",
    ]);
  });

  test("byTld gives TLD-major order", () => {
    const out = rankCandidates(V, ["com", "live", "me"], { byTld: true, limit: 10 });
    expect(out.map((c) => c.domain)).toEqual([
      "scryb.com",
      "scrib.com",
      "scryb.live",
      "scrib.live",
      "scryb.me",
      "scrib.me",
    ]);
  });

  test("fills rank 0..n-1 and carries name/tld/tier/strategy", () => {
    const out = rankCandidates(V, ["com", "ai"], { limit: 10 });
    expect(out.map((c) => c.rank)).toEqual([0, 1, 2, 3]);
    expect(out[3]).toEqual({
      domain: "scrib.ai",
      name: "scrib",
      tld: "ai",
      tier: 1,
      strategy: "spelling",
      rank: 3,
    });
  });

  test("truncates to limit and still ranks from 0", () => {
    const out = rankCandidates(V, ["com", "live", "me"], { limit: 4 });
    expect(out.length).toBe(4);
    expect(out.map((c) => c.domain)).toEqual([
      "scryb.com",
      "scryb.live",
      "scryb.me",
      "scrib.com",
    ]);
    expect(out.map((c) => c.rank)).toEqual([0, 1, 2, 3]);
  });

  test("limit 0 and empty inputs give an empty list", () => {
    expect(rankCandidates(V, ["com"], { limit: 0 })).toEqual([]);
    expect(rankCandidates([], ["com"], { limit: 5 })).toEqual([]);
    expect(rankCandidates(V, [], { limit: 5 })).toEqual([]);
  });

  test("skips invalid TLDs", () => {
    const out = rankCandidates(V, ["com", "1", "A I", "ai"], { limit: 10 });
    expect(out.map((c) => c.domain)).toEqual([
      "scryb.com",
      "scryb.ai",
      "scrib.com",
      "scrib.ai",
    ]);
  });
});
