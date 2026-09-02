import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChecker } from "../src/check/index.ts";

const LIVE = process.env.DOMAINSWEEP_LIVE === "1";
const cacheDir = mkdtempSync(join(tmpdir(), "domainsweep-live-"));
const checker = createChecker({ timeoutMs: 12000, cacheDir });

describe("live network", () => {
  test.skipIf(!LIVE)("google.com is taken via dns", async () => {
    const r = await checker.check("google.com");
    expect(r.status).toBe("taken");
    expect(r.method).toBe("dns");
  }, 30000);

  test.skipIf(!LIVE)("zzqxv9k3q.com is available via rdap", async () => {
    const r = await checker.check("zzqxv9k3q.com");
    expect(r.status).toBe("available");
    expect(r.method).toBe("rdap");
  }, 30000);

  test.skipIf(!LIVE)("zzqxv9k3q.io is available via whois", async () => {
    const r = await checker.check("zzqxv9k3q.io");
    expect(r.status).toBe("available");
    expect(r.method).toBe("whois");
  }, 30000);

  test.skipIf(!LIVE)("google.io is taken", async () => {
    const r = await checker.check("google.io");
    expect(r.status).toBe("taken");
  }, 30000);

  test.skipIf(!LIVE)("zzqxv9k3q.ai is available via rdap", async () => {
    const r = await checker.check("zzqxv9k3q.ai");
    expect(r.status).toBe("available");
    expect(r.method).toBe("rdap");
  }, 30000);
});
