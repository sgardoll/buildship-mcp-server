# Roadmap: buildship-mcp-server

## Overview

Take the buildship-mcp-server from a 0.1.0 prototype with known critical security vulnerabilities and missing production infrastructure to a 1.0 production-ready MCP server suitable for public showcase on GitHub. The milestone addresses all critical and major findings from a comprehensive code review, prioritized by severity: critical security fixes first, then test foundation, CI/linting infrastructure, correctness fixes, and finally the git sync tool that completes the stated end-to-end workflow.

## Milestones

- 🚧 **v1.0 Security & Production Readiness** - Phases 1-5 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Critical Security Fixes** - Path traversal in 6 tools + shell injection in setup script
- [x] **Phase 2: Test Foundation** - Test framework, path traversal tests, core tool workflow tests
- [ ] **Phase 3: CI & Linting** - GitHub Actions workflow + ESLint/Biome config
- [ ] **Phase 4: Correctness & Integrity Fixes** - Semver sorting, crypto IDs, atomic writes
- [ ] **Phase 5: Git Sync Tool** - Implement commit_and_push tool to complete end-to-end workflow

## Phase Details

### Phase 1: Critical Security Fixes
**Goal**: Eliminate all exploitable security vulnerabilities. No path traversal, no shell injection.
**Depends on**: Nothing (first phase)
**Success Criteria** (what must be TRUE):
  1. No tool accepts a path parameter that escapes the BuildShip repo root directory
  2. `setup-remote.mjs` cannot execute arbitrary shell commands via crafted input
  3. Path traversal attempts on all 6 vulnerable tools throw a clear error
  4. Existing tool functionality is unchanged for valid inputs
**Plans**: TBD

Plans:
- [x] 01-01: Add `safeJoin` path guard to `repo.ts` and replace all `path.join` calls in tools
- [x] 01-02: Fix shell injection in `setup-remote.mjs` (replace `execSync` with `execFileSync`)

### Phase 2: Test Foundation
**Goal**: Establish a test framework and prove the security fixes from Phase 1 work, plus cover core tool workflows.
**Depends on**: Phase 1
**Success Criteria** (what must be TRUE):
  1. Running `npm test` executes a test suite with meaningful coverage
  2. Path traversal attempts on all 6 fixed tools are tested and fail correctly
  3. Core tool workflows (create_node, create_workflow, add_node_to_workflow, update_node_file) have integration tests using a temp directory
  4. Overwrite protection and JSON validation in update_node_file are tested
**Plans**: TBD

Plans:
- [x] 02-01: Add test framework (node:test or vitest) and test script to package.json
- [x] 02-02: Write path traversal regression tests for all 6 fixed tools
- [x] 02-03: Write integration tests for core tool workflows

### Phase 3: CI & Linting
**Goal**: Automated quality gates run on every push and pull request.
**Depends on**: Phase 2
**Success Criteria** (what must be TRUE):
  1. GitHub Actions CI workflow runs on push and PR
  2. CI runs `tsc --noEmit`, tests, and linting
  3. ESLint or Biome is configured with sensible defaults for TypeScript
  4. `npm run lint` and `npm run format` scripts work locally
**Plans**: TBD

Plans:
- [ ] 03-01: Add ESLint flat config or Biome config with TypeScript rules
- [ ] 03-02: Add GitHub Actions CI workflow (build, typecheck, test, lint)

### Phase 4: Correctness & Integrity Fixes
**Goal**: Fix data integrity issues that could cause silent corruption or incorrect behavior.
**Depends on**: Phase 2
**Success Criteria** (what must be TRUE):
  1. `list_nodes` and `get_node` report the semantically latest version, not alphabetically last
  2. Workflow IDs and folder suffixes use `crypto.randomBytes` or `crypto.randomUUID`, not `Math.random`
  3. File writes are atomic (temp file + rename) — crash mid-write does not corrupt files
  4. Existing tests still pass after changes
**Plans**: TBD

Plans:
- [ ] 04-01: Fix semver version sorting (alphabetical → semantic compare)
- [ ] 04-02: Replace `Math.random` with `crypto` for ID generation
- [ ] 04-03: Implement atomic file writes (temp + rename pattern)

### Phase 5: Git Sync Tool
**Goal**: Complete the stated end-to-end workflow — agent changes are validated and pushed to GitHub.
**Depends on**: Phase 1, Phase 4
**Success Criteria** (what must be TRUE):
  1. A `sync_to_git` tool exists that stages, commits, and pushes changes to the BuildShip repo's git remote
  2. The tool uses `execFileSync` with args array (no shell injection risk)
  3. The tool validates that the working directory is a git repo before operating
  4. The README accurately describes the complete end-to-end workflow
**Plans**: TBD

Plans:
- [ ] 05-01: Implement `sync_to_git` tool with safe git operations
- [ ] 05-02: Update README to document the complete workflow

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Critical Security Fixes | v1.0 | 2/2 | Complete | 2026-07-04 |
| 2. Test Foundation | v1.0 | 3/3 | Complete | 2026-07-04 |
| 3. CI & Linting | v1.0 | 0/2 | Not started | - |
| 4. Correctness & Integrity Fixes | v1.0 | 0/3 | Not started | - |
| 5. Git Sync Tool | v1.0 | 0/2 | Not started | - |
