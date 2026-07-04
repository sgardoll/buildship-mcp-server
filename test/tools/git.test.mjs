import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import { syncToGit } from "../../dist/tools/git.js";
import { createNode } from "../../dist/tools/nodes.js";

let tempRepo;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-git-"));
  await mkdir(path.join(tempRepo, "nodes"), { recursive: true });
  await mkdir(path.join(tempRepo, "workflows"), { recursive: true });
  await mkdir(path.join(tempRepo, "flow-id-to-label"), { recursive: true });

  // Initialize a git repo for testing.
  execFileSync("git", ["init"], { cwd: tempRepo, encoding: "utf8" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: tempRepo, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: tempRepo,
    encoding: "utf8",
  });

  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
});

describe("sync_to_git — commit", () => {
  it("stages and commits changes", async () => {
    // Create a node to generate file changes.
    await createNode({ id: "git-test-node", label: "Git Test" });

    const result = await syncToGit({ message: "Add git-test-node", push: false });
    assert.equal(result.committed, true);
    assert.equal(result.pushed, false);
    assert.ok(result.commitHash);
    assert.ok(result.filesChanged >= 1);
  });

  it("returns nothing-to-commit when working tree is clean", async () => {
    const result = await syncToGit({ message: "no changes", push: false });
    assert.equal(result.committed, false);
    assert.equal(result.pushed, false);
    assert.equal(result.filesChanged, 0);
  });

  it("commits subsequent changes", async () => {
    // Create another node.
    await createNode({ id: "second-node", label: "Second" });

    const result = await syncToGit({ message: "Add second-node", push: false });
    assert.equal(result.committed, true);
    assert.ok(result.filesChanged >= 1);
  });
});

describe("sync_to_git — error handling", () => {
  it("throws clear error when not a git repo", async () => {
    // Create a non-git temp directory.
    const nonGitDir = await mkdtemp(path.join(tmpdir(), "bs-nogit-"));
    await mkdir(path.join(nonGitDir, "nodes"), { recursive: true });
    await mkdir(path.join(nonGitDir, "workflows"), { recursive: true });

    const originalRepo = process.env.BUILDSHIP_REPO;
    process.env.BUILDSHIP_REPO = nonGitDir;
    resetRepoRootCache();

    await assert.rejects(syncToGit({ message: "test", push: false }), /not a git repository/);

    // Restore the original repo.
    process.env.BUILDSHIP_REPO = originalRepo;
    resetRepoRootCache();
    await rm(nonGitDir, { recursive: true, force: true });
  });
});
