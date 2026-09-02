# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-02

### Added

- `domainsweep <name>...` CLI: generates lookalike variants of a name, ranks them
  against a TLD priority list, and reports each domain as available, taken or
  unknown.
- Availability ladder, cheapest signal first with short-circuit: DNS NS records
  → RDAP (via the cached IANA bootstrap file) → WHOIS on port 43 for TLDs with
  no RDAP service. No API key and no signup.
- Variant strategies `spelling`, `leet`, `affix` and `vowel`, in
  `DOMAIN_VARIANTS` order, with the exact name always ranked first.
- Flags: `-t/--tlds`, `-f/--free`, `--first [N]`, `--by-tld`, `--no-variants`,
  `--variants`, `--limit`, `--concurrency`, `--json`, `--dry-run`,
  `-v/--version`, `-h/--help`.
- Newline-delimited JSON output (`--json`) with one object per result.
- Layered configuration: built-in defaults → `~/.config/domainsweep/.env` →
  `./.env` → process environment → CLI flags. Keys: `DOMAIN_SORT_KEY`,
  `DOMAIN_VARIANTS`, `DOMAIN_MAX_VARIANTS`, `DOMAIN_LIMIT`,
  `DOMAIN_CONCURRENCY`, `DOMAIN_TIMEOUT_MS`, `DOMAIN_CACHE_DIR`.
- Conservative reporting: a dropping / `pendingDelete` name and a rate-limited
  WHOIS both report `unknown` with the reason, never `available`.
- Exit codes: `0` at least one available domain, `1` none, `2` usage error;
  `Ctrl-C` prints the running summary and exits `130`.
- Library API: `hunt`, `loadConfig`, `generateVariants`, `normalizeName`,
  `rankCandidates`, `parseTldList`, `createChecker`, `checkAll`, plus types.
- Node ESM build (`dist/`) with type declarations, so the CLI runs under plain
  `node` (>= 20) via `npx` as well as under Bun.

[unreleased]: https://github.com/sblattj/domainsweep/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sblattj/domainsweep/releases/tag/v0.1.0
