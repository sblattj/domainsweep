import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * `VERSION` in src/cli.ts is hardcoded so the CLI bundle has no runtime
 * dependency on package.json. This test is the anti-drift guard.
 */
test("cli VERSION matches package.json version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  const cli = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
  const m = cli.match(/^const VERSION = "([^"]+)";$/m);
  expect(m).not.toBeNull();
  expect(m![1]).toBe(pkg.version);
});
