import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRemote, checkVersion } from "../scripts/check-release.mjs";

const manifest = { version: "0.3.0" };
const lock = { version: "0.3.0", packages: { "": { version: "0.3.0" } } };

function apiError(status) {
  return Object.assign(new Error("gh api failed"), { stdout: `HTTP/2.0 ${status} Error\n` });
}

describe("release version gate", () => {
  it("requires a matching stable MAJOR.MINOR.PATCH version across all manifests", () => {
    assert.equal(checkVersion("0.3.0", manifest, lock), "v0.3.0");
    assert.equal(
      checkVersion(
        "1.0.0",
        { version: "1.0.0" },
        {
          version: "1.0.0",
          packages: { "": { version: "1.0.0" } },
        },
      ),
      "v1.0.0",
    );
    for (const invalid of [
      undefined,
      "v0.3.0",
      "0.3.0-rc.1",
      "0.3.0+build",
      "0.03.0",
      "01.0.0",
      "0.3.00",
      "0.3.0\n",
    ]) {
      assert.throws(() => checkVersion(invalid, manifest, lock), /stable MAJOR.MINOR.PATCH/);
    }
    assert.throws(() => checkVersion("0.3.1", manifest, lock), /package.json version/);
    assert.throws(
      () => checkVersion("0.3.0", manifest, { ...lock, version: "0.2.0" }),
      /package-lock.json version/,
    );
    assert.throws(
      () => checkVersion("0.3.0", manifest, { ...lock, packages: {} }),
      /packages\[""\]/,
    );
  });
});

describe("release remote gate", () => {
  it("allows an absent tag and release after checking every release page", () => {
    const calls = [];
    checkRemote("v0.3.0", "owner/repo", (args) => {
      calls.push(args);
      if (calls.length === 1) throw apiError(404);
      return JSON.stringify([[{ tag_name: "v0.2.0" }], []]);
    });
    assert.equal(calls[0].at(-1), "repos/owner/repo/git/ref/tags/v0.3.0");
    assert.ok(calls[1].includes("--paginate"));
  });

  it("refuses an existing tag before creating or replacing anything", () => {
    assert.throws(
      () => checkRemote("v0.3.0", "owner/repo", () => "HTTP/2.0 200 OK\n"),
      /Tag .* already exists/,
    );
  });

  it("fails closed on authorization, service and transport failures", () => {
    for (const status of [401, 403, 429, 500]) {
      assert.throws(
        () =>
          checkRemote("v0.3.0", "owner/repo", () => {
            throw apiError(status);
          }),
        /Unable to establish/,
      );
    }
    assert.throws(
      () =>
        checkRemote("v0.3.0", "owner/repo", () => {
          throw new Error("network unavailable");
        }),
      /Unable to establish/,
    );
  });

  it("refuses an existing draft even when its tag is absent", () => {
    let calls = 0;
    assert.throws(
      () =>
        checkRemote("v0.3.0", "owner/repo", () => {
          if (++calls === 1) throw apiError(404);
          return JSON.stringify([[], [{ tag_name: "v0.3.0", draft: true }]]);
        }),
      /including drafts/,
    );
  });

  it("refuses release enumeration errors and malformed responses", () => {
    for (const response of ["{}", "[{}]"]) {
      let calls = 0;
      assert.throws(
        () =>
          checkRemote("v0.3.0", "owner/repo", () => {
            if (++calls === 1) throw apiError(404);
            return response;
          }),
        /Unexpected release API response/,
      );
    }
    let calls = 0;
    assert.throws(
      () =>
        checkRemote("v0.3.0", "owner/repo", () => {
          if (++calls === 1) throw apiError(404);
          throw apiError(403);
        }),
      /gh api failed/,
    );
  });
});
