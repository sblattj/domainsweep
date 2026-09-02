#!/usr/bin/env bun
/**
 * Build the node-targeted ESM dist.
 *
 *   src/cli.ts   -> dist/cli.js   (#!/usr/bin/env node, mode 0755)
 *   src/index.ts -> dist/index.js
 *   src/*.ts     -> dist/index.d.ts (+ friends) via `tsc -p tsconfig.build.json`
 *
 * There are no runtime dependencies, so nothing is marked external.
 */
import { rm, readFile, writeFile, chmod, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const outdir = join(root, "dist");

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/cli.ts"), join(root, "src/index.ts")],
  outdir,
  target: "node",
  format: "esm",
  sourcemap: "none",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("Bun.build failed");
}

// Shebang: strip whatever the bundler carried over from src/cli.ts, prepend node's.
const cliPath = join(outdir, "cli.js");
let cli = await readFile(cliPath, "utf8");
cli = cli.replace(/^#![^\n]*\n/, "");
await writeFile(cliPath, `#!/usr/bin/env node\n${cli}`);
await chmod(cliPath, 0o755);

// Type declarations.
const tsc = spawnSync("bunx", ["tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
if (tsc.status !== 0) throw new Error(`tsc exited ${tsc.status}`);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await walk(outdir)).sort();
console.log(`\ndist/ (${files.length} files)`);
for (const f of files) {
  const s = await stat(f);
  console.log(`  ${relative(root, f).padEnd(34)} ${String(s.size).padStart(8)} B`);
}
