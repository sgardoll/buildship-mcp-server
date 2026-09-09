import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: tempRepo, encoding: "utf8" });
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
    const remoteHash = execFileSync("git", ["rev-parse", "refs/heads/main"], {
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

async function withIsolatedRepo(operation) {
  const repo = await mkdtemp(path.join(tmpdir(), "bs-git-case-"));
  const remote = await mkdtemp(path.join(tmpdir(), "bs-git-case-remote-"));
  const originalRepo = process.env.BUILDSHIP_REPO;
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  try {
    await mkdir(path.join(repo, "nodes"));
    await mkdir(path.join(repo, "workflows"));
    git("init", "--initial-branch=main");
    git("config", "user.name", "Test User");
    git("config", "user.email", "test@example.com");
    git("config", "push.default", "current");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    git("remote", "add", "origin", remote);
    process.env.BUILDSHIP_REPO = repo;
    resetRepoRootCache();
    await operation({ repo, remote, git });
  } finally {
    process.env.BUILDSHIP_REPO = originalRepo;
    resetRepoRootCache();
    await rm(repo, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
}

describe("sync_to_git — exact paths and recovery", () => {
  it("pushes existing commits after a commit-only sync without making a new commit", async () => {
    await withIsolatedRepo(async ({ remote, git }) => {
      await createNode({ id: "push-later", label: "Push Later" });
      const committed = await syncToGit({ message: "commit first", push: false });
      const pushed = await syncToGit({ message: "push later", push: true });
      assert.equal(pushed.committed, false);
      assert.equal(pushed.pushed, true);
      assert.equal(pushed.pushError, null);
      assert.equal(pushed.filesChanged, 0);
      assert.equal(git("rev-parse", "HEAD").trim(), committed.commitHash);
      assert.equal(
        execFileSync("git", ["rev-parse", "refs/heads/main"], {
          cwd: remote,
          encoding: "utf8",
        }).trim(),
        committed.commitHash,
      );
    });
  });

  it("retries a failed push after the remote is repaired", async () => {
    await withIsolatedRepo(async ({ repo, remote, git }) => {
      await createNode({ id: "retry-push", label: "Retry Push" });
      git("remote", "set-url", "origin", path.join(repo, "missing-remote"));
      const failed = await syncToGit({ message: "keep local commit", push: true });
      assert.equal(failed.committed, true);
      assert.equal(failed.pushed, false);
      assert.ok(failed.pushError);
      const failedAgain = await syncToGit({ message: "retry", push: true });
      assert.equal(failedAgain.committed, false);
      assert.equal(failedAgain.pushed, false);
      assert.ok(failedAgain.pushError);
      git("remote", "set-url", "origin", remote);
      const retry = await syncToGit({ message: "retry", push: true });
      assert.equal(retry.committed, false);
      assert.equal(retry.pushed, true);
      assert.equal(git("rev-parse", "HEAD").trim(), failed.commitHash);
    });
  });

  it("does not bypass validation for quoted or arrow-containing workflow paths", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      const folders = ["bad folder", "bad\nfolder", "bad -> folder", "caf\u00e9"];
      if (process.platform !== "win32") folders.push("bad\\folder");
      for (const folder of folders) {
        const dir = path.join(repo, "workflows", folder);
        await mkdir(dir);
        await writeFile(path.join(dir, "schema.json"), "{}\n");
        await assert.rejects(syncToGit({ message: "invalid workflow", push: false }));
        assert.equal(git("diff", "--cached", "--name-only"), "");
        await rm(dir, { recursive: true });
      }
    });
  });

  it("stages literal paths with whitespace and arrows, including a file rename", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      const labels = path.join(repo, "flow-id-to-label");
      await mkdir(labels);
      const names = ["space name.txt", "arrow -> name.txt", "line\nname.txt", "tab\tname.txt"];
      for (const name of names) await writeFile(path.join(labels, name), "label\n");
      const result = await syncToGit({ message: "literal filenames", push: false });
      assert.equal(result.filesChanged, names.length);
      assert.deepEqual(
        new Set(git("ls-files", "-z").split("\0").filter(Boolean)),
        new Set(names.map((name) => `flow-id-to-label/${name}`)),
      );
      await rename(path.join(labels, names[1]), path.join(labels, "renamed -> label.txt"));
      await syncToGit({ message: "rename label", push: false });
      assert.equal(git("status", "--porcelain"), "");
      assert.ok(git("ls-files", "-z").includes("flow-id-to-label/renamed -> label.txt\0"));
    });
  });

  it("commits when the optional label directory is absent", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      await createNode({ id: "no-labels", label: "No Labels" });
      await rm(path.join(repo, "flow-id-to-label"), { recursive: true });
      const result = await syncToGit({ message: "node only", push: false });
      assert.equal(result.committed, true);
      assert.equal(git("status", "--porcelain"), "");
    });
  });

  it("rejects symlink-only changes before staging", async () => {
    await withIsolatedRepo(async ({ repo, remote, git }) => {
      await mkdir(path.join(repo, "flow-id-to-label"));
      for (const relative of [
        "nodes/linked-node",
        "workflows/linked-workflow",
        "flow-id-to-label/linked.txt",
      ]) {
        const linked = path.join(repo, relative);
        await symlink(remote, linked);
        await assert.rejects(
          syncToGit({ message: "must reject link", push: false }),
          /symbolic links/i,
        );
        assert.equal(git("ls-files"), "");
        await rm(linked);
      }
    });
  });

  it("validates and stages paths relative to a nested BuildShip directory", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      const nested = path.join(repo, "nested buildship");
      await mkdir(path.join(nested, "nodes"), { recursive: true });
      await mkdir(path.join(nested, "workflows"));
      process.env.BUILDSHIP_REPO = nested;
      resetRepoRootCache();
      await createNode({ id: "nested-node", label: "Nested Node" });
      const main = path.join(nested, "nodes", "nested-node", "1.0.0", "main.ts");
      const original = await readFile(main, "utf8");
      await writeFile(main, "export const broken: = 1;\n");
      await assert.rejects(
        syncToGit({ message: "invalid nested node", push: false }),
        /deployment validation failed/i,
      );
      assert.equal(git("ls-files"), "");
      await writeFile(main, original);
      const result = await syncToGit({ message: "nested node", push: false });
      assert.equal(result.committed, true);
      assert.ok(
        git("ls-files", "-z").includes("nested buildship/nodes/nested-node/1.0.0/main.ts\0"),
      );
      assert.equal(git("status", "--porcelain"), "");
    });
  });

  it("rolls back the index when the initial commit fails", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      await createNode({ id: "retry-commit", label: "Retry Commit" });
      const hook = path.join(repo, ".git", "hooks", "pre-commit");
      await writeFile(hook, "#!/bin/sh\nexit 1\n");
      await chmod(hook, 0o755);
      await assert.rejects(syncToGit({ message: "rejected commit", push: false }), /rolled back/);
      assert.equal(git("ls-files"), "");
      assert.ok(
        (await readFile(path.join(repo, "nodes", "retry-commit", "1.0.0", "main.ts"))).length,
      );
      await rm(hook);
      assert.equal((await syncToGit({ message: "retry commit", push: false })).committed, true);
    });
  });

  it("preserves pre-existing staged changes", async () => {
    await withIsolatedRepo(async ({ repo, git }) => {
      await createNode({ id: "staged-guard", label: "Staged Guard" });
      await writeFile(path.join(repo, "unrelated.txt"), "user change\n");
      git("add", "unrelated.txt");
      await assert.rejects(
        syncToGit({ message: "must refuse", push: false }),
        /already contains staged changes/,
      );
      assert.equal(git("diff", "--cached", "--name-only"), "unrelated.txt\n");
    });
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
