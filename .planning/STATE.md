# Project State: buildship-mcp-server

## Current Milestone

**v1.0 Security & Production Readiness** — Phase 1 of 5

## Current Phase

**Phase 1: Critical Security Fixes** — Complete

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
