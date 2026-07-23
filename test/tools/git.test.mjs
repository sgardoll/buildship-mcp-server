import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import { syncToGit } from "../../dist/tools/git.js";
import { createNode } from "../../dist/tools/nodes.js";

let tempRepo;
let tempRemote;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-git-"));
  tempRemote = await mkdtemp(path.join(tmpdir(), "bs-git-remote-"));
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
  execFileSync("git", ["init", "--bare"], { cwd: tempRemote, encoding: "utf8" });
  execFileSync("git", ["remote", "add", "origin", tempRemote], {
    cwd: tempRepo,
    encoding: "utf8",
  });
  execFileSync("git", ["config", "push.default", "current"], {
    cwd: tempRepo,
    encoding: "utf8",
  });

  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
  await rm(tempRemote, { recursive: true, force: true });
});

describe("sync_to_git — commit", () => {
  it("stages and commits changes", async () => {
    // Create a node to generate file changes.
    await createNode({ id: "git-test-node", label: "Git Test" });

    const result = await syncToGit({ message: "Add git-test-node", push: true });
    assert.equal(result.committed, true);
    assert.equal(result.pushed, true);
    assert.ok(result.commitHash);
    assert.ok(result.filesChanged >= 1);
    const remoteHash = execFileSync("git", ["rev-parse", "refs/heads/master"], {
      cwd: tempRemote,
      encoding: "utf8",
    }).trim();
    assert.equal(remoteHash, result.commitHash);
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

  it("does not stage or commit unrelated repository files", async () => {
    await writeFile(path.join(tempRepo, "unrelated.txt"), "leave me alone\n", "utf8");
    const result = await syncToGit({ message: "should not commit", push: false });
    assert.equal(result.committed, false);
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: tempRepo,
      encoding: "utf8",
    });
    assert.match(status, /\?\? unrelated\.txt/);
  });

  it("blocks commits when changed BuildShip artifacts fail deployment validation", async () => {
    const mainPath = path.join(tempRepo, "nodes", "second-node", "1.0.0", "main.ts");
    const original = await readFile(mainPath, "utf8");
    await writeFile(mainPath, "export const broken: = 1;\n", "utf8");
    await assert.rejects(
      syncToGit({ message: "must not commit invalid node", push: false }),
      /deployment validation failed/i,
    );
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: tempRepo,
      encoding: "utf8",
    });
    assert.equal(staged, "");
    await writeFile(mainPath, original, "utf8");
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
