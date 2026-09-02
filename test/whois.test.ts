import { describe, expect, test } from "bun:test";
import { classifyWhois } from "../src/check/index.ts";

// Fixtures modelled on responses observed on 2026-09-02 from the real
// port-43 servers (whois.nic.io, whois.registry.co, whois.nic.me,
// whois.nic.so, whois.nic.sh, whois.gg, whois.nic.us).

const FREE_IO = `% IANA WHOIS server
Domain not found.

>>> Last update of WHOIS database: 2026-09-02T18:04:11Z <<<
`;

const FREE_ME = `Domain not found.

>>> Last update of WHOIS database: 2026-09-02T18:04:12Z <<<
`;

const FREE_SH = `% This is the Identity Digital Whois server.
Domain not found.
`;

const FREE_CO = `The queried object does not exist: DOMAIN NOT FOUND

>>> Last update of WHOIS database: 2026-09-02T18:04:13Z <<<
`;

// Note: a FREE .so response still contains a "Domain Name:" line.
const FREE_SO = `Domain Name: zzqxv9k3.so
The queried object does not exist: No Object Found

>>> Last update of WHOIS database: 2026-09-02T18:04:14Z <<<
`;

const FREE_GG = `% Access and use restricted to the .gg registry.

NOT FOUND

>>> Last update of WHOIS database: 2026-09-02T18:04:15Z <<<
`;

const FREE_US = `No Data Found

>>> Last update of WHOIS database: 2026-09-02T18:04:16Z <<<
`;

const TAKEN_IO = `Domain Name: google.io
Registry Domain ID: D503300000040453546-LRMS
Registrar: MarkMonitor Inc.
Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited
Creation Date: 2014-06-12T22:14:07Z

>>> Last update of WHOIS database: 2026-09-02T18:04:17Z <<<
`;

const TAKEN_GG = `% Access and use restricted to the .gg registry.

Domain:
     google.gg

Domain Status:
     Active

Registration status:
     Registered until 15th September 2026
`;

const RATE_LIMITED = `% Error: 55000000002 Your connection limit exceeded. Please slow down and try again later.
`;

const GARBAGE = `%% comment only
sdlkfjsldkfj wubba lubba dub dub
more noise
`;

describe("classifyWhois — free responses", () => {
  const cases: [string, string][] = [
    ["io", FREE_IO],
    ["me", FREE_ME],
    ["sh", FREE_SH],
    ["co", FREE_CO],
    ["so", FREE_SO],
    ["gg", FREE_GG],
    ["us", FREE_US],
  ];
  for (const [tld, text] of cases) {
    test(`.${tld} not-found → available`, () => {
      expect(classifyWhois(text).status).toBe("available");
    });
  }
});

describe("classifyWhois — taken responses", () => {
  test(".io taken", () => {
    const r = classifyWhois(TAKEN_IO);
    expect(r.status).toBe("taken");
  });
  test(".gg taken", () => {
    expect(classifyWhois(TAKEN_GG).status).toBe("taken");
  });
});

describe("classifyWhois — unknown", () => {
  test("dropzone / pending delete → unknown, never available", () => {
    const io = [
      "This domain is currently available for application via the Identity Digital Dropzone service.",
      ">>> Last update of WHOIS database: 2026-09-02T16:46:12Z <<<",
    ].join("\n");
    expect(classifyWhois(io)).toEqual({
      status: "unknown",
      detail: "whois: dropping (backorder/auction), not registrable today",
    });
    const pd = "Domain Name: example.us\nDomain Status: pendingDelete https://icann.org/epp#pendingDelete\n";
    expect(classifyWhois(pd).status).toBe("unknown");
  });

  test("rate limit → unknown, rate limited detail", () => {
    const r = classifyWhois(RATE_LIMITED);
    expect(r.status).toBe("unknown");
    expect(r.detail).toBe("whois: rate limited");
  });
  test("garbage → unknown with first non-comment line", () => {
    const r = classifyWhois(GARBAGE);
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("wubba lubba dub dub");
  });
  test("empty → unknown", () => {
    expect(classifyWhois("").status).toBe("unknown");
  });
  test("detail is truncated to 80 chars", () => {
    const r = classifyWhois("x".repeat(300));
    expect(r.detail.length).toBeLessThanOrEqual(80);
  });
});

describe("classifyWhois — ordering", () => {
  test("not-found beats the Domain Name: line (.so case)", () => {
    expect(classifyWhois(FREE_SO).status).toBe("available");
    expect(classifyWhois(FREE_SO).detail.toLowerCase()).toContain("no object found");
  });
});
