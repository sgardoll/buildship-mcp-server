import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import { createNode } from "../../dist/tools/nodes.js";

let repo;
before(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "bs-node-source-"));
  await mkdir(path.join(repo, "nodes"));
  await mkdir(path.join(repo, "workflows"));
  process.env.BUILDSHIP_REPO = repo;
  resetRepoRootCache();
});
after(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("node source validation", () => {
  const inputs = {
    value: { type: "string" },
    nested: { type: "object", properties: { child: { type: "string" } } },
  };
  for (const [id, mainTs] of [
    ["alias", "export default function ({ value: renamed }) { return renamed; }"],
    ["nested", "export default function ({ nested: { child } }) { return child; }"],
    ["rest", "export default function ({ value, ...rest }) { return value; }"],
    ["promise", 'export default async function () { return Promise.resolve("ok"); }'],
    ["named", 'const run = () => "ok"; export default run;'],
    ["export-alias", 'function run() { return "ok"; } export { run as default };'],
  ]) {
    it(`accepts valid ${id} source`, async () => {
      await createNode({
        id: `source-${id}`,
        label: id,
        inputs,
        output: { type: "string" },
        mainTs,
      });
    });
  }

  for (const [id, mainTs] of [
    ["concise", "export default () => 42;"],
    ["promise", "export default async function () { return Promise.resolve(42); }"],
    ["missing-return", 'export default function () { const value = "unused"; }'],
    ["not-callable", 'export default "not a function";'],
    ["any-return", "export default function (): any { return 42; }"],
    ["unknown-return", "export default function (): unknown { return 42; }"],
    ["any-promise", "export default async function (): Promise<any> { return 42; }"],
    ["any-arrow", "export default (): any => 42;"],
    [
      "overloaded-any",
      "export default function run(): any; export default function run(): any { return 42; }",
    ],
    ["undeclared", "export default function ({ missing: renamed }) { return renamed; }"],
  ]) {
    it(`rejects ${id} source incompatible with the node contract`, async () => {
      await assert.rejects(
        createNode({ id: `invalid-${id}`, label: id, inputs, output: { type: "string" }, mainTs }),
        /deployment validation failed/i,
      );
    });
  }
});
