import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  readText,
  resetRepoRootCache,
  safeJoin,
  withRepoMutationLock,
  writeFilesTransaction,
  writeText,
} from "../dist/repo.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "bs-transaction-"));
  await mkdir(path.join(root, "nodes"));
  await mkdir(path.join(root, "workflows"));
  const priorRoot = process.env.BUILDSHIP_REPO;
  process.env.BUILDSHIP_REPO = root;
  resetRepoRootCache();
  t.after(async () => {
    if (priorRoot === undefined) delete process.env.BUILDSHIP_REPO;
    else process.env.BUILDSHIP_REPO = priorRoot;
    resetRepoRootCache();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

describe("safeJoin — valid paths", () => {
  it("allows nested subdirectories within base", () => {
    const result = safeJoin("/tmp/base", "subdir", "file.txt");
    assert.equal(result, "/tmp/base/subdir/file.txt");
  });

  it("allows base path itself with no segments", () => {
    const result = safeJoin("/tmp/base");
    assert.equal(result, "/tmp/base");
  });

  it("allows single-level subdirectory", () => {
    const result = safeJoin("/tmp/base", "nodes");
    assert.equal(result, "/tmp/base/nodes");
  });

  it("treats absolute path segments as relative (safe)", () => {
    const result = safeJoin("/tmp/base", "/etc/passwd");
    assert.equal(result, "/tmp/base/etc/passwd");
  });

  it("allows dot-only segment (resolves to base)", () => {
    const result = safeJoin("/tmp/base", ".");
    assert.equal(result, "/tmp/base");
  });
});

describe("safeJoin — path traversal blocked", () => {
  it("blocks ../ traversal", () => {
    assert.throws(
      () => safeJoin("/tmp/base", "../../etc/passwd"),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks single ../ traversal", () => {
    assert.throws(() => safeJoin("/tmp/base", ".."), /Path escapes the allowed directory/);
  });

  it("blocks traversal with .txt suffix (setLabel/getLabel pattern)", () => {
    assert.throws(
      () => safeJoin("/tmp/base/flow-id-to-label", "../../.ssh/authorized_keys.txt"),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks deep traversal from nested base", () => {
    assert.throws(
      () => safeJoin("/tmp/base/nodes", "../../.."),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks traversal that escapes to sibling directory", () => {
    assert.throws(
      () => safeJoin("/tmp/base", "../base2/secret"),
      /Path escapes the allowed directory/,
    );
  });
});

describe("writeFilesTransaction — rollback", () => {
  it("preserves files when transaction preparation fails", async (t) => {
    const root = await fixture(t);
    const first = path.join(root, "first.txt");
    const blockedParent = path.join(root, "blocked");
    await writeFile(first, "original\n", "utf8");
    await writeFile(blockedParent, "not a directory\n", "utf8");

    await assert.rejects(
      writeFilesTransaction([
        { file: first, content: "changed\n" },
        { file: path.join(blockedParent, "second.txt"), content: "new\n" },
      ]),
    );
    assert.equal(await readFile(first, "utf8"), "original\n");
  });

  it("restores files and removes new directories when validation fails", async (t) => {
    const root = await fixture(t);
    const existing = path.join(root, "existing.txt");
    const created = path.join(root, "nodes", "new-node", "1.0.0", "main.ts");
    await writeFile(existing, "original\n");
    await assert.rejects(
      writeFilesTransaction(
        [
          { file: existing, content: "changed\n" },
          { file: created, content: "new\n" },
        ],
        async () => {
          throw new Error("validation failed");
        },
      ),
      /validation failed/,
    );
    assert.equal(await readFile(existing, "utf8"), "original\n");
    await assert.rejects(access(path.join(root, "nodes", "new-node")));
  });
});

describe("repository filesystem containment", () => {
  it("rejects file and directory symlinks without reading or changing their targets", async (t) => {
    const root = await fixture(t);
    const outside = await mkdtemp(path.join(tmpdir(), "bs-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "private\n");
    const linkedFile = path.join(root, "secret.txt");
    await symlink(secret, linkedFile);
    await symlink(outside, path.join(root, "flow-id-to-label"));
    await assert.rejects(readText(linkedFile), /Symbolic links/);
    await assert.rejects(writeText(linkedFile, "replaced"), /Symbolic links/);
    await assert.rejects(
      writeText(path.join(root, "flow-id-to-label", "secret.txt"), "replaced"),
      /Symbolic links/,
    );
    await assert.rejects(
      writeFilesTransaction([{ file: linkedFile, content: "replaced" }]),
      /Symbolic links/,
    );
    assert.equal(await readFile(secret, "utf8"), "private\n");
  });

  it("allows a configured root alias and rejects paths outside that root", async (t) => {
    const root = await fixture(t);
    const aliasParent = await mkdtemp(path.join(tmpdir(), "bs-alias-"));
    t.after(() => rm(aliasParent, { recursive: true, force: true }));
    const alias = path.join(aliasParent, "repository");
    await symlink(root, alias);
    process.env.BUILDSHIP_REPO = alias;
    resetRepoRootCache();
    await writeText(path.join(alias, "nodes", "allowed.txt"), "allowed");
    assert.equal(await readFile(path.join(root, "nodes", "allowed.txt"), "utf8"), "allowed\n");
    await assert.rejects(
      writeText(path.join(aliasParent, "outside.txt"), "bad"),
      /escapes the repository/,
    );
  });
});

describe("repository mutation serialization", () => {
  it("holds the lock through nested transactions and releases it after failure", async (t) => {
    const root = await fixture(t);
    const file = path.join(root, "counter.txt");
    await writeText(file, "0");
    const increment = () =>
      withRepoMutationLock(async () => {
        const value = Number(await readText(file));
        await writeFilesTransaction([{ file, content: `${value + 1}\n` }]);
      });
    await Promise.all([increment(), increment()]);
    assert.equal(await readText(file), "2\n");
    await assert.rejects(
      withRepoMutationLock(async () => {
        throw new Error("failed");
      }),
      /failed/,
    );
    await increment();
    assert.equal(await readText(file), "3\n");
  });
});
