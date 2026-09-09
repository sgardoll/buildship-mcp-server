import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const entry = new URL("../dist/index.js", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const env = { ...process.env, BUILDSHIP_REPO: "/missing-buildship-repository-for-cli-test" };

test("--version reports package metadata without a repository or MCP startup", () => {
  const output = execFileSync(process.execPath, [fileURLToPath(entry), "--version"], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(output, `${pkg.version}\n`);
});

for (const [name, mock, expectedStatus] of [
  [
    "release",
    'async () => new Response(JSON.stringify({tag_name:"v9.0.0",draft:false,prerelease:false}),{status:200})',
    "update_available",
  ],
  ["no published release", 'async () => new Response("",{status:404})', "no_release"],
  ["offline", 'async () => { throw new Error("offline"); }', "unavailable"],
]) {
  test(`--check-updates returns JSON when ${name}, without a repository`, () => {
    const script = `globalThis.fetch = ${mock}; process.argv.push("--check-updates"); await import(${JSON.stringify(entry.href)});`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    const result = JSON.parse(output);
    assert.equal(result.installedVersion, pkg.version);
    assert.equal(result.status, expectedStatus);
    assert.equal(
      result.updateAvailable,
      expectedStatus === "unavailable" ? null : expectedStatus === "update_available",
    );
  });
}
