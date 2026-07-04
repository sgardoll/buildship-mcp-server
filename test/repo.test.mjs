import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeJoin } from "../dist/repo.js";

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
    assert.throws(
      () => safeJoin("/tmp/base", ".."),
      /Path escapes the allowed directory/,
    );
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
