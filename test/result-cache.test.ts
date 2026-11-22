import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createChecker } from "../src/check/index.ts";
import { loadConfig } from "../src/config.ts";
import type { CheckResult } from "../src/types.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "domainsweep-rc-"));

/** Counts calls so a test can prove the network ladder did or did not run. */
function fakeLookup(status: CheckResult["status"] = "available") {
  const calls: string[] = [];
  const lookup = async (domain: string): Promise<CheckResult> => {
    calls.push(domain);
    return { domain, status, method: "rdap", detail: "rdap 404", ms: 5 };
  };
  return { calls, lookup };
}

describe("result cache", () => {
  test("off by default: every check runs the lookup and writes nothing", async () => {
    const dir = tmp();
    const f = fakeLookup();
    const c = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup });
    await c.check("scryb.com");
    await c.check("scryb.com");
    expect(f.calls.length).toBe(2);
    expect(fs.existsSync(path.join(dir, "results"))).toBe(false);
  });

  test("a fresh answer is served from the cache, marked cached", async () => {
    const dir = tmp();
    const f = fakeLookup("taken");
    const c = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 60_000 } });
    const first = await c.check("scryb.com");
    const second = await c.check("SCRYB.com");
    expect(f.calls.length).toBe(1);
    expect(first.cached).toBeUndefined();
    expect(second).toMatchObject({ domain: "scryb.com", status: "taken", method: "rdap", detail: "rdap 404", cached: true });
  });

  test("a stale entry is looked up again", async () => {
    const dir = tmp();
    const f = fakeLookup();
    let now = 1_000_000;
    const c = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 10, now: () => now } });
    await c.check("scryb.com");
    now += 11;
    await c.check("scryb.com");
    expect(f.calls.length).toBe(2);
  });

  test("unknown is never cached", async () => {
    const dir = tmp();
    const f = fakeLookup("unknown");
    const c = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 60_000 } });
    await c.check("scryb.com");
    await c.check("scryb.com");
    expect(f.calls.length).toBe(2);
  });

  test("refresh mode always looks up, then stores", async () => {
    const dir = tmp();
    const f = fakeLookup();
    const r = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 60_000, mode: "refresh" } });
    await r.check("scryb.com");
    await r.check("scryb.com");
    expect(f.calls.length).toBe(2);
    const u = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 60_000 } });
    expect((await u.check("scryb.com")).cached).toBe(true);
    expect(f.calls.length).toBe(2);
  });

  test("only mode never looks up: any-age hit is served, a miss is unknown via method cache", async () => {
    const dir = tmp();
    const f = fakeLookup();
    let now = 1_000_000;
    await createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 10, now: () => now } }).check("scryb.com");
    now += 1_000_000;
    const o = createChecker({ timeoutMs: 1000, cacheDir: dir, lookup: f.lookup, results: { ttlMs: 10, mode: "only", now: () => now } });
    expect(await o.check("scryb.com")).toMatchObject({ status: "available", cached: true });
    expect(await o.check("other.com")).toMatchObject({ status: "unknown", method: "cache", detail: "result cache miss" });
    expect(f.calls.length).toBe(1);
  });
});

describe("DOMAIN_RESULT_TTL_MS", () => {
  const bare = (env: Record<string, string>) => ({ cwd: tmp(), home: tmp(), env });
  test("defaults to 0 (result cache off)", () => {
    expect(loadConfig(bare({})).resultTtlMs).toBe(0);
  });
  test("reads a positive integer", () => {
    expect(loadConfig(bare({ DOMAIN_RESULT_TTL_MS: "3600000" })).resultTtlMs).toBe(3_600_000);
  });
});
