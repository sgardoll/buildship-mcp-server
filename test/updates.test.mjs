import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CheckForUpdatesSchema, createUpdateChecker } from "../dist/updates.js";

const release = (tag = "v0.4.0", fields = {}) =>
  new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, ...fields }));

describe("explicit update checks", () => {
  it("is lazy and uses only a fixed unauthenticated GitHub request", async () => {
    let calls = 0;
    const check = createUpdateChecker({
      installedVersion: "0.3.0",
      now: () => 0,
      fetch: async (url, options) => {
        calls += 1;
        assert.equal(
          url,
          "https://api.github.com/repos/sgardoll/buildship-mcp-server/releases/latest",
        );
        assert.equal(options.method, "GET");
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "error");
        assert.deepEqual(options.headers, {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        });
        assert.equal(options.body, undefined);
        return release("v0.4.0", { html_url: "https://attacker.invalid/" });
      },
    });
    assert.equal(calls, 0);
    const result = await check({});
    assert.equal(result.status, "update_available");
    assert.equal(result.installedVersion, "0.3.0");
    assert.equal(result.latestVersion, "0.4.0");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.cached, false);
    assert.equal(result.checkedAt, "1970-01-01T00:00:00.000Z");
    assert.equal(
      result.releaseUrl,
      "https://github.com/sgardoll/buildship-mcp-server/releases/tag/v0.4.0",
    );
    assert.ok(result.updateInstructions.some((instruction) => instruction.includes("npm ci")));
    assert.ok(
      result.updateInstructions.some((instruction) =>
        instruction.includes("git switch --detach refs/tags/v0.4.0"),
      ),
    );
  });

  for (const [installedVersion, tag, newer] of [
    ["0.3.0", "v0.3.0", false],
    ["0.4.0", "v0.3.0", false],
    ["2.9.9", "10.0.0", true],
    ["10.0.0", "v2.99.99", false],
    ["0.9.9", "0.10.0", true],
    ["0.3.2", "0.3.10", true],
    ["0.3.0+local", "v0.3.0+release", false],
  ]) {
    it(`compares ${installedVersion} with ${tag} numerically`, async () => {
      const check = createUpdateChecker({ installedVersion, fetch: async () => release(tag) });
      const result = await check({});
      assert.equal(result.updateAvailable, newer);
      assert.equal(result.status, newer ? "update_available" : "up_to_date");
      if (!newer) assert.deepEqual(result.updateInstructions, []);
    });
  }

  it("caches successful responses for 24 hours and force refreshes", async () => {
    let clock = 100;
    let calls = 0;
    const check = createUpdateChecker({
      installedVersion: "0.3.0",
      now: () => clock,
      fetch: async () => {
        calls += 1;
        return release();
      },
    });
    const first = await check({});
    first.updateInstructions.push("poison cache");
    clock += 24 * 60 * 60 * 1000 - 1;
    const cached = await check({});
    assert.equal(cached.cached, true);
    assert.equal(cached.checkedAt, first.checkedAt);
    assert.ok(!cached.updateInstructions.includes("poison cache"));
    assert.equal(calls, 1);
    clock += 1;
    assert.equal((await check({})).cached, false);
    assert.equal(calls, 2);
    assert.equal((await check({ force: true })).cached, false);
    assert.equal(calls, 3);
  });

  it("treats GitHub 404 as normal absence and caches it", async () => {
    let calls = 0;
    const check = createUpdateChecker({
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 404 });
      },
    });
    const result = await check({});
    assert.equal(result.status, "no_release");
    assert.equal(result.latestVersion, null);
    assert.equal(result.updateAvailable, false);
    assert.deepEqual(result.updateInstructions, []);
    assert.equal((await check({})).cached, true);
    assert.equal(calls, 1);
  });

  it("briefly caches failures and retries after 60 seconds", async () => {
    let clock = 0;
    let calls = 0;
    const check = createUpdateChecker({
      now: () => clock,
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 429 });
      },
    });
    const result = await check({});
    assert.equal(result.status, "unavailable");
    assert.equal(result.updateAvailable, null);
    assert.match(result.message, /HTTP 429/);
    clock = 59_999;
    assert.equal((await check({})).cached, true);
    assert.equal(calls, 1);
    clock = 60_000;
    assert.equal((await check({})).cached, false);
    assert.equal(calls, 2);
  });

  it("coalesces concurrent calls including forced checks", async () => {
    let resolveFetch;
    let calls = 0;
    const check = createUpdateChecker({
      fetch: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    const first = check({});
    const second = check({ force: true });
    const third = check({});
    assert.equal(calls, 1);
    resolveFetch(release());
    assert.deepEqual(await second, await first);
    assert.deepEqual(await third, await first);
  });

  for (const [name, response] of [
    ["draft", () => release("v0.4.0", { draft: true })],
    ["prerelease", () => release("v0.4.0", { prerelease: true })],
    ["prerelease tag", () => release("v0.4.0-beta.1")],
    ["leading zero", () => release("v00.4.0")],
    ["partial version", () => release("v0.4")],
    ["hostile tag", () => release("../../other-repo")],
    ["oversized version", () => release(`v${"9".repeat(129)}.0.0`)],
    ["missing metadata", () => new Response(JSON.stringify({ tag_name: "v0.4.0" }))],
    ["invalid JSON", () => new Response("{")],
    ["null JSON", () => new Response("null")],
    ["HTTP failure", () => new Response(null, { status: 503 })],
    [
      "oversized content-length",
      () => new Response("{}", { headers: { "content-length": "1048577" } }),
    ],
    ["oversized streamed body", () => new Response(" ".repeat(1048577))],
  ]) {
    it(`reports ${name} as unavailable`, async () => {
      const check = createUpdateChecker({ fetch: async () => response() });
      const result = await check({});
      assert.equal(result.status, "unavailable");
      assert.equal(result.updateAvailable, null);
      assert.equal(result.latestVersion, null);
      assert.equal(result.releaseUrl, null);
    });
  }

  it("handles network failure without exposing exception details", async () => {
    const check = createUpdateChecker({
      fetch: async () => {
        throw new Error("private detail");
      },
    });
    const result = await check({});
    assert.equal(result.status, "unavailable");
    assert.ok(!result.message.includes("private detail"));
  });

  it("times out an unresponsive request even if fetch ignores abort", async () => {
    let signal;
    const check = createUpdateChecker({
      timeoutMs: 10,
      fetch: (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    });
    assert.equal((await check({})).status, "unavailable");
    assert.equal(signal.aborted, true);
  });

  it("applies the same timeout to a stalled response body", async () => {
    let canceled = false;
    const check = createUpdateChecker({
      timeoutMs: 10,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
            },
          }),
        ),
    });
    assert.equal((await check({})).status, "unavailable");
    assert.equal(canceled, true);
  });

  it("accepts a valid response at the exact byte limit", async () => {
    const json = JSON.stringify({ tag_name: "v0.4.0", draft: false, prerelease: false });
    const body = json.padEnd(1048576, " ");
    const check = createUpdateChecker({
      installedVersion: "0.3.0",
      fetch: async () => new Response(body),
    });
    assert.equal((await check({})).status, "update_available");
  });

  it("validates caller arguments before requesting the network", async () => {
    const check = createUpdateChecker({
      fetch: async () => {
        assert.fail("unexpected network request");
      },
    });
    assert.deepEqual(CheckForUpdatesSchema.parse({}), { force: false });
    await assert.rejects(check({ force: "yes" }), /boolean/);
  });
});
