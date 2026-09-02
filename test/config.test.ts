import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULTS, DEFAULT_SORT_KEY, loadConfig } from "../src/config.ts";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "domainsweep-"));
}

/** An isolated home/cwd pair with no .env files, so defaults are visible. */
function bare() {
  return { cwd: tmp(), home: tmp(), env: {} as Record<string, string | undefined> };
}

describe("loadConfig defaults", () => {
  test("returns the built-in defaults when nothing is set", () => {
    const c = loadConfig(bare());
    expect(c.sortKey).toEqual(DEFAULT_SORT_KEY);
    expect(c.sortKey[0]).toBe("com");
    expect(c.sortKey[1]).toBe("ai");
    expect(c.variants).toEqual(["spelling", "leet", "affix", "vowel"]);
    expect(c.maxVariants).toBe(25);
    expect(c.limit).toBe(80);
    expect(c.concurrency).toBe(6);
    expect(c.timeoutMs).toBe(8000);
  });

  test("cacheDir defaults under home", () => {
    const b = bare();
    expect(loadConfig(b).cacheDir).toBe(path.join(b.home, ".cache", "domainsweep"));
  });

  test("DEFAULTS is exported and self-consistent", () => {
    expect(DEFAULTS.sortKey).toEqual(DEFAULT_SORT_KEY);
    expect(DEFAULTS.limit).toBe(80);
  });
});

describe("DOMAIN_SORT_KEY parsing", () => {
  const cases: Array<[string, string, string[]]> = [
    ["bracketed", "[com,ai,live]", ["com", "ai", "live"]],
    ["bare comma", "com,ai", ["com", "ai"]],
    ["dotted", "[com, ai,.live]", ["com", "ai", "live"]],
    ["spaced", "com ai live", ["com", "ai", "live"]],
    ["mixed case + quotes", '"COM", .AI', ["com", "ai"]],
    ["dedupes", "com,ai,com", ["com", "ai"]],
    ["trailing junk", "[com,,ai,]", ["com", "ai"]],
  ];
  for (const [label, raw, want] of cases) {
    test(label, () => {
      const c = loadConfig({ ...bare(), env: { DOMAIN_SORT_KEY: raw } });
      expect(c.sortKey).toEqual(want);
    });
  }

  test("empty value falls back to the default order", () => {
    const c = loadConfig({ ...bare(), env: { DOMAIN_SORT_KEY: "  " } });
    expect(c.sortKey).toEqual(DEFAULT_SORT_KEY);
  });
});

describe("precedence", () => {
  test("env beats cwd/.env beats home config", () => {
    const home = tmp();
    const cwd = tmp();
    fs.mkdirSync(path.join(home, ".config", "domainsweep"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "domainsweep", ".env"),
      "# home config\nDOMAIN_SORT_KEY=[org]\nDOMAIN_LIMIT=11\nDOMAIN_CONCURRENCY=3\n",
    );
    fs.writeFileSync(path.join(cwd, ".env"), 'DOMAIN_SORT_KEY="net"\nDOMAIN_LIMIT=22\n');

    // home only
    expect(loadConfig({ home, cwd: tmp(), env: {} }).sortKey).toEqual(["org"]);
    // cwd overrides home, but home still supplies unset keys
    const both = loadConfig({ home, cwd, env: {} });
    expect(both.sortKey).toEqual(["net"]);
    expect(both.limit).toBe(22);
    expect(both.concurrency).toBe(3);
    // env overrides both
    const all = loadConfig({ home, cwd, env: { DOMAIN_SORT_KEY: "ai", DOMAIN_LIMIT: "33" } });
    expect(all.sortKey).toEqual(["ai"]);
    expect(all.limit).toBe(33);
  });

  test("the .env parser handles comments, quotes, blanks and malformed lines", () => {
    const cwd = tmp();
    fs.writeFileSync(
      path.join(cwd, ".env"),
      [
        "# a comment",
        "",
        "   ",
        "not-a-pair",
        "DOMAIN_LIMIT = 42 ",
        "DOMAIN_CACHE_DIR='/tmp/dh-cache'",
        'DOMAIN_VARIANTS="leet"',
        "export DOMAIN_CONCURRENCY=2",
      ].join("\n"),
    );
    const c = loadConfig({ cwd, home: tmp(), env: {} });
    expect(c.limit).toBe(42);
    expect(c.cacheDir).toBe("/tmp/dh-cache");
    expect(c.variants).toEqual(["leet"]);
    expect(c.concurrency).toBe(2);
  });
});

describe("integers", () => {
  for (const bad of ["", "abc", "0", "-4", "1.5.2", "NaN"]) {
    test(`DOMAIN_LIMIT=${JSON.stringify(bad)} falls back to 80`, () => {
      expect(loadConfig({ ...bare(), env: { DOMAIN_LIMIT: bad } }).limit).toBe(80);
    });
  }
  test("valid integers are taken", () => {
    const c = loadConfig({
      ...bare(),
      env: {
        DOMAIN_MAX_VARIANTS: "5",
        DOMAIN_LIMIT: "9",
        DOMAIN_CONCURRENCY: "1",
        DOMAIN_TIMEOUT_MS: "1500",
      },
    });
    expect([c.maxVariants, c.limit, c.concurrency, c.timeoutMs]).toEqual([5, 9, 1, 1500]);
  });
});

describe("DOMAIN_VARIANTS", () => {
  test("unknown names are dropped", () => {
    const c = loadConfig({ ...bare(), env: { DOMAIN_VARIANTS: "leet,bogus,vowel" } });
    expect(c.variants).toEqual(["leet", "vowel"]);
  });

  test('"exact" is implicit and removed', () => {
    const c = loadConfig({ ...bare(), env: { DOMAIN_VARIANTS: "exact,leet" } });
    expect(c.variants).toEqual(["leet"]);
  });

  test("all-unknown falls back to the defaults", () => {
    const c = loadConfig({ ...bare(), env: { DOMAIN_VARIANTS: "nope,nah" } });
    expect(c.variants).toEqual(DEFAULTS.variants);
  });

  test("an explicitly empty list means exact-only", () => {
    const c = loadConfig({ ...bare(), env: { DOMAIN_VARIANTS: "exact" } });
    expect(c.variants).toEqual([]);
  });
});

describe("cli --help", () => {
  test("exits 0 and documents DOMAIN_SORT_KEY", () => {
    const r = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli.ts", "--help"],
      cwd: path.join(import.meta.dir, ".."),
    });
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode).toBe(0);
    expect(out).toContain("DOMAIN_SORT_KEY");
  });
});
