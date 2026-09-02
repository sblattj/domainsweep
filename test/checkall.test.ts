import { describe, expect, test } from "bun:test";
import { checkAll } from "../src/check/index.ts";
import type { Candidate, CheckResult, Checker } from "../src/types.ts";

const cand = (domain: string, rank: number): Candidate => ({
  domain,
  name: domain.split(".")[0]!,
  tld: domain.split(".")[1]!,
  tier: 0,
  strategy: "exact",
  rank,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake checker with per-domain delay + status, tracking in-flight count. */
function fakeChecker(spec: Record<string, { ms: number; status: CheckResult["status"] }>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const checker: Checker = {
    async check(domain) {
      const s = spec[domain] ?? { ms: 1, status: "taken" as const };
      started.push(domain);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(s.ms);
      inFlight--;
      return { domain, status: s.status, method: "dns", detail: "fake", ms: s.ms };
    },
  };
  return { checker, started, get maxInFlight() { return maxInFlight; } };
}

describe("checkAll", () => {
  test("emits in rank order even when later ranks resolve first", async () => {
    const cands = [cand("a.com", 0), cand("b.com", 1), cand("c.com", 2), cand("d.com", 3)];
    const { checker } = fakeChecker({
      "a.com": { ms: 60, status: "taken" },
      "b.com": { ms: 40, status: "taken" },
      "c.com": { ms: 20, status: "taken" },
      "d.com": { ms: 1, status: "taken" },
    });
    const order: string[] = [];
    const out = await checkAll(cands, checker, {
      concurrency: 4,
      onResult: (c) => order.push(c.domain),
    });
    expect(order).toEqual(["a.com", "b.com", "c.com", "d.com"]);
    expect(out.map((r) => r.domain)).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  test("concurrency is never exceeded", async () => {
    const cands = Array.from({ length: 12 }, (_, i) => cand(`d${i}.com`, i));
    const spec: Record<string, { ms: number; status: CheckResult["status"] }> = {};
    for (let i = 0; i < 12; i++) spec[`d${i}.com`] = { ms: 10 + (i % 4) * 5, status: "taken" };
    const f = fakeChecker(spec);
    const out = await checkAll(cands, f.checker, { concurrency: 3 });
    expect(f.maxInFlight).toBeLessThanOrEqual(3);
    expect(f.maxInFlight).toBeGreaterThan(1);
    expect(out).toHaveLength(12);
  });

  test("stopAfterAvailable: 1 stops early and ends at the first available", async () => {
    const cands = Array.from({ length: 10 }, (_, i) => cand(`d${i}.com`, i));
    const spec: Record<string, { ms: number; status: CheckResult["status"] }> = {};
    for (let i = 0; i < 10; i++) spec[`d${i}.com`] = { ms: 10, status: i === 2 ? "available" : "taken" };
    const f = fakeChecker(spec);
    const emitted: string[] = [];
    const out = await checkAll(cands, f.checker, {
      concurrency: 2,
      stopAfterAvailable: 1,
      onResult: (c) => emitted.push(c.domain),
    });
    expect(emitted).toEqual(["d0.com", "d1.com", "d2.com"]);
    expect(out.at(-1)!.status).toBe("available");
    expect(out).toHaveLength(3);
    // in-flight work may have started, but nothing past the stop point is emitted
    expect(f.started.length).toBeLessThan(10);
  });

  test("empty input resolves to an empty list", async () => {
    const { checker } = fakeChecker({});
    expect(await checkAll([], checker, { concurrency: 4 })).toEqual([]);
  });
});
