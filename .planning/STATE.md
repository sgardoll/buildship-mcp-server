# Project State: buildship-mcp-server

## Current Milestone

**v1.0 Security & Production Readiness** — Phase 1 of 5

## Current Phase

**Milestone complete** — All 5 phases done

## Active Plan

None — phase not yet planned.

## Context

BuildShip MCP Server is a Model Context Protocol server that lets AI assistants create and edit BuildShip custom nodes and workflows directly in a GitHub-synced repository. The repo is at version 0.1.0 with a working stdio MCP server, 10 tools, and an excellent README — but a code review identified critical security vulnerabilities (path traversal, shell injection) and major production-readiness gaps (zero tests, no CI, no linting, non-atomic writes, incorrect semver sorting, incomplete git workflow).

This milestone takes the repo from "0.1.0 prototype" to "1.0 production-ready" by fixing all critical and major review findings in priority order.

## Tech Stack

- **Language:** TypeScript (strict mode, ESM, NodeNext)
- **Runtime:** Node.js >= 18
- **Dependencies:** @modelcontextprotocol/sdk, zod, zod-to-json-schema
- **Transport:** stdio JSON-RPC
- **Build:** tsc → dist/
- **No test framework yet** (Phase 2 will add one)
- **No CI yet** (Phase 3 will add GitHub Actions)
- **No linter yet** (Phase 3 will add ESLint or Biome)

## Key Files

- `src/index.ts` — MCP server setup, tool dispatch, error handling
- `src/repo.ts` — Filesystem primitives, repo root resolution
- `src/jsonSchema.ts` — Zod → JSON Schema conversion for MCP inputSchema
- `src/tools/nodes.ts` — Node tools (list, get, create, update)
- `src/tools/workflows.ts` — Workflow tools (list, get, create, add node, labels)
- `scripts/setup-remote.mjs` — Git remote setup helper (has shell injection)
- `README.md` — Comprehensive install guide for 10+ MCP clients

## Decision Log

- **2026-07-04:** Milestone v1.0 created from code review findings. 5 phases defined, prioritized by severity (Critical → Major). Phase 1 fixes path traversal + shell injection. Phase 2 adds tests (proves Phase 1 fixes work). Phase 3 adds CI + linting. Phase 4 fixes correctness issues. Phase 5 implements git push tool.
- **2026-07-04:** Phase 1 complete. Added `safeJoin` to `repo.ts` — prevents path traversal via `..`, absolute paths. Replaced all 11 vulnerable `path.join` call sites in `workflows.ts` (6 sites) and `nodes.ts` (5 sites). Fixed shell injection in `setup-remote.mjs` by replacing `execSync` (string interpolation) with `execFileSync` (args array). Verified: `tsc --noEmit` clean, end-to-end MCP test confirms path traversal blocked and valid tools still work.
- **2026-07-04:** Phase 2 complete. Added `node:test` framework (zero deps). Added `resetRepoRootCache()` to `repo.ts` for test isolation. 37 tests across 3 files: `repo.test.mjs` (10 safeJoin unit tests), `nodes.test.mjs` (14 node tool integration + path traversal tests), `workflows.test.mjs` (13 workflow tool integration + path traversal tests). All pass.
- **2026-07-04:** Phase 3 complete. Added Biome 2.x for linting + formatting (single dev dep). Fixed all lint issues: useTemplate (7 string concat → template literals), noNonNullAssertion (4 non-null assertions → proper type narrowing), noExplicitAny (4 `any` → `unknown` with type assertions), noTemplateCurlyInString (1 biome-ignore for intentional), organizeImports (auto-fixed). Added GitHub Actions CI workflow (typecheck + lint + test on push/PR). All 37 tests pass, Biome clean, tsc clean.
- **2026-07-04:** Phase 4 complete. Three fixes: (1) Semver sorting — added `compareSemverAsc` to `nodes.ts`, `listNodes` and `getNode` now sort versions semantically (1.0.10 > 1.0.2, not alphabetical). (2) Crypto IDs — replaced `Math.random` with `crypto.randomBytes` in `workflows.ts` via shared `randomString` helper. (3) Atomic writes — added `writeAtomic` to `repo.ts` (temp file + rename), `writeJson` and `writeText` now crash-safe. Added semver sorting test (38 total, all pass).
- **2026-07-04:** Phase 5 complete. Implemented `sync_to_git` tool in `src/tools/git.ts` — stages, commits, and optionally pushes changes via `execFileSync` (no shell, no injection). Push failures are soft (commit succeeds, pushError returned). Registered tool in `index.ts`. Added 4 tests (commit, nothing-to-commit, subsequent commit, non-git-repo error). Updated README with tool reference, example, smoketest, and safety guardrails. All 42 tests pass, Biome clean, tsc clean.
