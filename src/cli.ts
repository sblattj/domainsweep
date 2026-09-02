#!/usr/bin/env bun
/** domainsweep CLI: rank lookalike domains and check which are free. */
import { parseArgs } from "node:util";
import type { Candidate, CheckResult, Config, VariantStrategy } from "./types.ts";
import { loadConfig } from "./config.ts";
import { generateVariants, normalizeName } from "./variants.ts";
import { parseTldList, rankCandidates } from "./rank.ts";
import { checkAll, createChecker } from "./check/index.ts";

const VERSION = "0.1.0";

const USAGE = `domainsweep v${VERSION} — find free domain names

Usage:
  domainsweep <name> [more names...] [options]

Options:
  -t, --tlds <list>      override DOMAIN_SORT_KEY for this run
                         ("[com, ai,.live]" | "com,ai" | "com ai")
  -f, --free             only print available domains
      --first [N]        stop after N available domains (default 1)
      --by-tld           TLD-major order (all .com, then all .ai, ...)
      --no-variants      check only the exact name
      --variants <list>  override DOMAIN_VARIANTS
                         (spelling,leet,affix,vowel)
      --limit <n>        override DOMAIN_LIMIT
      --concurrency <n>  override DOMAIN_CONCURRENCY
      --json             newline-delimited JSON on stdout, one object per result
      --dry-run          print the ranked candidate list without checking
  -v, --version          print the version
  -h, --help             show this help

Environment (see also ~/.config/domainsweep/.env and ./.env):
  DOMAIN_SORT_KEY        TLD priority   (default: com,ai,io,co,app,dev,live,me,
                                                  net,org,so,sh,xyz,gg,to,us)
  DOMAIN_VARIANTS        strategies     (default: spelling,leet,affix,vowel)
  DOMAIN_MAX_VARIANTS    variant cap    (default: 25)
  DOMAIN_LIMIT           domains/run    (default: 80)
  DOMAIN_CONCURRENCY     parallelism    (default: 6)
  DOMAIN_TIMEOUT_MS      per lookup     (default: 8000)
  DOMAIN_CACHE_DIR       cache location (default: ~/.cache/domainsweep)

Exit codes: 0 = at least one available domain, 1 = none, 2 = usage error.
`;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => paint("32", s);
const red = (s: string) => paint("31", s);
const yellow = (s: string) => paint("33", s);
const dim = (s: string) => paint("2", s);

function die(msg: string): never {
  process.stderr.write(`domainsweep: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function posInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) die(`${flag} expects a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

interface Tally {
  available: number;
  taken: number;
  unknown: number;
}

function formatLine(c: Candidate, r: CheckResult, width: number): string {
  const pad = c.domain.padEnd(width, " ");
  const ms = `${r.ms}ms`;
  if (r.status === "available") {
    return `${green("✓")} ${pad}  ${green("available")}  ${r.method.padEnd(5)} ${dim(ms)}`;
  }
  if (r.status === "taken") {
    return `${red("✗")} ${pad}  ${red("taken")}      ${r.method.padEnd(5)} ${dim(ms)}`;
  }
  const detail = !r.detail
    ? r.method
    : r.detail.startsWith(`${r.method}:`)
      ? r.detail
      : `${r.method}: ${r.detail}`;
  return `${yellow("?")} ${pad}  ${yellow("unknown")}    ${detail}`;
}

/**
 * `--first` is optional-value, which parseArgs cannot express: a bare `--first`
 * would either error or swallow the next positional. Rewrite it to `--first=1`
 * unless it is immediately followed by an integer.
 */
function normalizeFirstFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--first") {
      const next = argv[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        out.push(`--first=${next}`);
        i++;
      } else {
        out.push("--first=1");
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

async function main(rawArgv: string[]): Promise<number> {
  const argv = normalizeFirstFlag(rawArgv);
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        tlds: { type: "string", short: "t" },
        free: { type: "boolean", short: "f" },
        first: { type: "string" },
        "by-tld": { type: "boolean" },
        "no-variants": { type: "boolean" },
        variants: { type: "string" },
        limit: { type: "string" },
        concurrency: { type: "string" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    die((err as Error).message);
  }
  const { values: v, positionals } = parsed;

  if (v.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (v.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (positionals.length === 0) die("expected at least one name to hunt");

  const stopAfterAvailable = v.first === undefined ? undefined : posInt(v.first, "--first");

  const base = loadConfig();
  const cfg: Config = {
    ...base,
    sortKey: v.tlds !== undefined ? parseTldList(v.tlds, base.sortKey) : base.sortKey,
    variants: v["no-variants"]
      ? []
      : v.variants !== undefined
        ? (loadConfig({ env: { DOMAIN_VARIANTS: v.variants }, cwd: "/nonexistent", home: "/nonexistent" })
            .variants as VariantStrategy[])
        : base.variants,
    limit: posInt(v.limit, "--limit") ?? base.limit,
    concurrency: posInt(v.concurrency, "--concurrency") ?? base.concurrency,
  };

  const json = Boolean(v.json);
  const freeOnly = Boolean(v.free);
  const byTld = Boolean(v["by-tld"]);
  const out = (s: string) => process.stdout.write(s);
  const note = (s: string) => {
    if (!json) process.stderr.write(s);
  };

  const tally: Tally = { available: 0, taken: 0, unknown: 0 };
  const started = Date.now();
  let interrupted = false;

  const summary = () => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    note(
      `\n${tally.available} available · ${tally.taken} taken · ${tally.unknown} unknown` +
        ` in ${secs}s${interrupted ? " (interrupted)" : ""}\n`,
    );
  };

  process.on("SIGINT", () => {
    interrupted = true;
    summary();
    process.exit(130);
  });

  for (const raw of positionals) {
    const name = normalizeName(raw);
    if (!name) die(`${JSON.stringify(raw)} does not contain a usable domain label`);

    const variants = generateVariants(name, { variants: cfg.variants, maxVariants: cfg.maxVariants });
    const candidates = rankCandidates(variants, cfg.sortKey, { byTld, limit: cfg.limit });
    const width = candidates.reduce((w, c) => Math.max(w, c.domain.length), 0);

    note(
      `${name}: exact + ${variants.length - 1} variants × ${cfg.sortKey.length} tlds → checking ` +
        `${candidates.length} candidates (limit ${cfg.limit}) in ${byTld ? "tld" : "name"}-major order\n`,
    );

    if (v["dry-run"]) {
      for (const c of candidates) {
        if (json) out(`${JSON.stringify(c)}\n`);
        else out(`${String(c.rank).padStart(3)}  ${c.domain.padEnd(width)}  ${dim(`t${c.tier} ${c.strategy}`)}\n`);
      }
      continue;
    }

    const checker = createChecker({ timeoutMs: cfg.timeoutMs, cacheDir: cfg.cacheDir });
    await checkAll(candidates, checker, {
      concurrency: cfg.concurrency,
      stopAfterAvailable,
      onResult: (c, r) => {
        tally[r.status] += 1;
        if (freeOnly && r.status !== "available") return;
        if (json) {
          out(
            `${JSON.stringify({
              domain: c.domain,
              name: c.name,
              tld: c.tld,
              tier: c.tier,
              strategy: c.strategy,
              rank: c.rank,
              status: r.status,
              method: r.method,
              detail: r.detail,
              ms: r.ms,
            })}\n`,
          );
          return;
        }
        out(`${formatLine(c, r, width)}\n`);
      },
    });
  }

  if (v["dry-run"]) return 0;
  summary();
  return tally.available > 0 ? 0 : 1;
}

const code = await main(process.argv.slice(2));
process.exit(code);
