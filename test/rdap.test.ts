import { describe, expect, test } from "bun:test";
import { rdapCheck } from "../src/check/rdap.ts";

const bootstrap = new Map<string, string[]>([
  ["com", ["https://rdap.verisign.com/com/v1/"]],
  ["ai", ["https://rdap.identitydigital.services/rdap/"]],
]);

const FAST = { backoffMs: [1, 1, 1] };

const res = (status: number, body?: unknown, headers?: Record<string, string>) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/rdap+json", ...(headers ?? {}) },
  });

describe("rdapCheck", () => {
  test("no RDAP server for the TLD → null", async () => {
    const r = await rdapCheck("scryb.io", bootstrap, 5000, async () => res(200), FAST);
    expect(r).toBeNull();
  });

  test("200 → taken", async () => {
    let url = "";
    const r = await rdapCheck(
      "scryb.com",
      bootstrap,
      5000,
      async (u: any) => {
        url = String(u);
        return res(200, { ldhName: "SCRYB.COM" });
      },
      FAST,
    );
    expect(r?.status).toBe("taken");
    expect(r?.method).toBe("rdap");
    expect(url).toBe("https://rdap.verisign.com/com/v1/domain/scryb.com");
  });

  test("404 → available, with errorCode/title in detail", async () => {
    const r = await rdapCheck(
      "zzqxv9k3.com",
      bootstrap,
      5000,
      async () => res(404, { errorCode: 404, title: "Not Found" }),
      FAST,
    );
    expect(r?.status).toBe("available");
    expect(r?.detail).toContain("404");
    expect(r?.detail).toContain("Not Found");
  });

  test("429 then 200 → taken after one retry", async () => {
    let calls = 0;
    const r = await rdapCheck(
      "scryb.com",
      bootstrap,
      5000,
      async () => {
        calls++;
        return calls === 1 ? res(429, undefined, { "retry-after": "0" }) : res(200, {});
      },
      FAST,
    );
    expect(calls).toBe(2);
    expect(r?.status).toBe("taken");
  });

  test("500 three times → unknown", async () => {
    let calls = 0;
    const r = await rdapCheck(
      "scryb.com",
      bootstrap,
      5000,
      async () => {
        calls++;
        return res(500);
      },
      FAST,
    );
    expect(calls).toBe(3);
    expect(r?.status).toBe("unknown");
    expect(r?.detail).toContain("500");
  });

  test("other status (403) → unknown", async () => {
    const r = await rdapCheck("scryb.com", bootstrap, 5000, async () => res(403), FAST);
    expect(r?.status).toBe("unknown");
    expect(r?.detail).toContain("403");
  });

  test("network error → unknown with the message", async () => {
    const r = await rdapCheck(
      "scryb.com",
      bootstrap,
      5000,
      async () => {
        throw new Error("boom");
      },
      FAST,
    );
    expect(r?.status).toBe("unknown");
    expect(r?.detail).toContain("boom");
  });

  test("timeout/abort → unknown", async () => {
    const r = await rdapCheck(
      "scryb.com",
      bootstrap,
      20,
      (_u: any, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }) as Promise<Response>,
      FAST,
    );
    expect(r?.status).toBe("unknown");
    expect(r?.method).toBe("rdap");
  });

  test("base URL without a trailing slash still forms a valid path", async () => {
    let url = "";
    const bs = new Map([["ai", ["https://rdap.identitydigital.services/rdap"]]]);
    await rdapCheck(
      "x.ai",
      bs,
      5000,
      async (u: any) => {
        url = String(u);
        return res(200, {});
      },
      FAST,
    );
    expect(url).toBe("https://rdap.identitydigital.services/rdap/domain/x.ai");
  });
});
