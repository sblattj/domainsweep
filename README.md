# domainsweep

You already have a name. **domainsweep** tells you which suffix or spelling of it
is actually free — the exact name plus its lookalike variants, across TLDs **in
your priority order**, using RDAP, WHOIS port 43 and DNS directly. No API key, no
signup, no LLM.

[![npm](https://img.shields.io/npm/v/domainsweep)](https://www.npmjs.com/package/domainsweep)
[![CI](https://github.com/sblattj/domainsweep/actions/workflows/ci.yml/badge.svg)](https://github.com/sblattj/domainsweep/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![domainsweep demo](docs/demo.gif)

```
$ domainsweep scryb --first 3
scryb: exact + 25 variants × 16 tlds → checking 80 candidates (limit 80) in name-major order
✗ scryb.com    taken      dns   269ms
✗ scryb.ai     taken      dns   349ms
? scryb.io     unknown    whois: dropping (backorder/auction), not registrable today
✓ scryb.co     available  whois 1402ms
✗ scryb.app    taken      dns   744ms
✗ scryb.dev    taken      dns   841ms
✓ scryb.live   available  rdap  1340ms
✗ scryb.me     taken      dns   688ms
✗ scryb.net    taken      dns   510ms
✓ scryb.org    available  rdap  783ms

3 available · 6 taken · 1 unknown in 2.3s
```

(Real output, 2026-09-02.)

## Is this for you?

- You already have a name and don't need one invented for you.
- You want to know which **suffix or spelling** of it is really free, including
  the TLDs (`.io`, `.co`, `.me`, …) that have no RDAP server.
- You want the answers **in your order** — `.com` first, or whatever you put in
  `DOMAIN_SORT_KEY` — streamed as they land, not a grid you have to re-read.

## Quickstart

```sh
npx domainsweep scryb          # node >= 20, nothing to install
npm i -g domainsweep           # then: domainsweep scryb --first 3
bunx domainsweep scryb         # bun works too
```

## How it compares

|  | **domainsweep** | `domainhunt` (npm) | a registrar search box |
| --- | --- | --- | --- |
| Input | a name you already have | a plain-English description ("community for technical founders") | one name at a time |
| Variants | exact + spelling / leet / affix / vowel lookalikes | LLM- or template-generated name ideas | none |
| TLD order | yours, `DOMAIN_SORT_KEY` | fixed default `com,io,ai,dev,sh` | the registrar's |
| Lookup | DNS → RDAP → WHOIS:43 | RDAP only | registrar's own feed |
| WHOIS fallback for `.io/.co/.me/…` | yes | no (those TLDs have no RDAP server) | n/a |
| Dropping / backorder names | reported `unknown`, never free | not distinguished | often shown as "make an offer" |
| LLM required | no | optional (codex/cursor/ollama/lmstudio) | no |
| API key | none | none | account/upsell |

[`domainhunt`](https://github.com/hunvreus/domain-hunt) solves a different problem — **ideation**, turning a description
into candidate names. If you don't have a name yet, start there; if you do,
start here.

## Ranking order

`.com` first, `.ai` second, then the popular rest — and the exact name before any
variant. So for `scryb` the head of the list is exactly the order you would try
by hand:

```
scryb.com → scryb.ai → scryb.io → … → scryb.live → scryb.me → scrib.com → scr1b.com
```

Variants come in tiers, in `DOMAIN_VARIANTS` order: tier 0 is the exact name,
then by default `spelling` (scryb → scrib, skryb, scrybe), `leet` (scryb → scr1b,
5cryb), `affix` (getscryb, scrybhq) and `vowel` (scrb, scrub). Reorder the
strategies to reorder the tiers.
`--by-tld` flips to TLD-major order: every name on `.com` first, then every name
on `.ai`, and so on.

## Usage

```
domainsweep <name> [more names...] [options]
```

| Flag | Meaning |
| --- | --- |
| `-t, --tlds <list>` | Override `DOMAIN_SORT_KEY` for this run. `"[com, ai,.live]"`, `"com,ai"` and `"com ai"` all parse. |
| `-f, --free` | Print only the available domains. |
| `--first [N]` | Stop after N available domains are found (default 1 when given bare). |
| `--by-tld` | TLD-major order instead of name-major. |
| `--no-variants` | Check only the exact name. |
| `--variants <list>` | Override `DOMAIN_VARIANTS` (`spelling,leet,affix,vowel`). |
| `--limit <n>` | Max domains checked this run. |
| `--concurrency <n>` | Parallel lookups. |
| `--json` | Newline-delimited JSON on stdout, one object per result: `{domain,name,tld,tier,strategy,rank,status,method,detail,ms}`. Nothing else is printed. |
| `--dry-run` | Print the ranked candidate list without checking anything. |
| `-v, --version` / `-h, --help` | |

Multiple positional names are allowed and are hunted in turn. Results stream in
rank order as they land. Colour is used only when stdout is a TTY and `NO_COLOR`
is unset. `Ctrl-C` prints the summary so far and exits 130.

**Exit codes:** `0` at least one available domain, `1` none found, `2` usage error.

## Configuration

| Key | Default |
| --- | --- |
| `DOMAIN_SORT_KEY` | `com,ai,io,co,app,dev,live,me,net,org,so,sh,xyz,gg,to,us` |
| `DOMAIN_VARIANTS` | `spelling,leet,affix,vowel` |
| `DOMAIN_MAX_VARIANTS` | `25` |
| `DOMAIN_LIMIT` | `80` |
| `DOMAIN_CONCURRENCY` | `6` |
| `DOMAIN_TIMEOUT_MS` | `8000` |
| `DOMAIN_CACHE_DIR` | `~/.cache/domainsweep` |

`DOMAIN_SORT_KEY` accepts brackets or none, commas or spaces, leading dots or
none: `[com, ai,.live]` and `com ai live` are the same list. Unknown names in
`DOMAIN_VARIANTS` are dropped with a warning on stderr; `exact` is implicit and
is ignored if listed. Integer keys fall back to their default on anything that
is not a positive integer.

**Precedence**, lowest to highest:

1. Built-in defaults
2. `~/.config/domainsweep/.env`
3. `./.env` in the current directory
4. The process environment
5. Command-line flags

The two `.env` files are parsed by domainsweep itself (`KEY=VALUE`, `#` comments,
optional quotes), so the home config is honoured no matter where you run from.

## How availability is decided

Cheapest signal first, and the run short-circuits as soon as one is conclusive:

1. **DNS.** If the domain has NS records, it is registered → `taken`. Fast and
   free, but the absence of NS proves nothing, so a miss falls through.
2. **RDAP.** The registry's own JSON, resolved through the IANA bootstrap file
   (cached in `DOMAIN_CACHE_DIR`). `404` → `available`, `200` → `taken`.
3. **WHOIS** on port 43, for TLDs with no RDAP service — `.io`, `.co`, `.me`,
   `.so`, `.sh`, `.gg`, `.us` among them. The "no match" wording is per-registry
   and is matched conservatively.

## Caveats

- **An RDAP `404` is not a promise.** It can also mean the label is reserved,
  premium-priced, or blocked at the registry. The only proof a domain is
  purchasable is a registrar's checkout page.
- **A dropping name is reported `unknown`, not free.** Registry WHOIS phrases
  like "available for application via the … Dropzone service" or
  `pendingDelete` mean the name is in a backorder auction or redemption window
  and cannot be registered today. The `detail` column says so.
- **WHOIS servers rate-limit hard.** When one does, the result is `unknown` with
  the reason in `detail` — never a guess. Keep `DOMAIN_CONCURRENCY` low.
- **`unknown` is never counted as free.** It exits with the others and does not
  satisfy `--first`.
- **Registry data lags.** A domain registered minutes ago can still look free.
- **domainsweep never registers anything** and has no registrar account, no
  affiliate links, and makes no purchase of any kind.

## Library use

```ts
import { hunt, loadConfig, rankCandidates } from "domainsweep";

const results = await hunt("scryb", { sortKey: ["com", "ai"], stopAfterAvailable: 1 });
console.log(results.filter((r) => r.status === "available").map((r) => r.domain));
```

`loadConfig`, `generateVariants`, `normalizeName`, `rankCandidates`,
`parseTldList`, `createChecker` and `checkAll` are all exported too. Zero runtime
dependencies.

## License

MIT.
