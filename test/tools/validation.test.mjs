import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import { createNode } from "../../dist/tools/nodes.js";
import { validateDeployment } from "../../dist/tools/validation.js";
import { createWorkflow } from "../../dist/tools/workflows.js";

let tempRepo;
let workflowFolder;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-validation-"));
  await mkdir(path.join(tempRepo, "nodes"), { recursive: true });
  await mkdir(path.join(tempRepo, "workflows"), { recursive: true });
  await mkdir(path.join(tempRepo, "flow-id-to-label"), { recursive: true });
  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();

  await createNode({
    id: "validated-node",
    label: "Validated Node",
    inputs: { value: { type: "string" } },
    required: ["value"],
    output: { type: "string" },
    mainTs:
      "export default async function ({ value }: NodeInputs): Promise<NodeOutput> {\n  return value;\n}\n",
  });
  const workflow = await createWorkflow({
    name: "validated workflow",
    inputs: { value: { type: "string" } },
    nodes: [
      {
        nodeId: "validated-node",
        values: { value: { _$keys_: ["inputs", "value"] } },
      },
    ],
  });
  workflowFolder = workflow.folder;
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
});

describe("validate_deployment", () => {
  it("validates a node, workflow, and complete repository", async () => {
    const node = await validateDeployment({ node: { id: "validated-node" } });
    const workflow = await validateDeployment({ workflow: { folder: workflowFolder } });
    const all = await validateDeployment({ all: true });
    assert.equal(node.valid, true);
    assert.equal(workflow.valid, true);
    assert.equal(all.valid, true);
    assert.ok(all.checked.includes("node:validated-node@1.0.0"));
    assert.ok(all.checked.includes(`workflow:${workflowFolder}`));
  });

  it("reports unknown node references as deployment errors", async () => {
    const schemaPath = path.join(tempRepo, "workflows", workflowFolder, "schema.json");
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const nodeId = Object.keys(schema.nodeValues).find(
      (id) =>
        !("config.method" in schema.nodeValues[id]) &&
        !("_$bsStatusCode_" in schema.nodeValues[id]),
    );
    schema.nodeValues[nodeId].bad = {
      _$keys_: ["33333333-3333-4333-8333-333333333333", "value"],
    };
    await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    const result = await validateDeployment({ workflow: { folder: workflowFolder } });
    assert.equal(result.valid, false);
    assert.match(result.errors.map((error) => error.message).join("\n"), /unknown node id/);
  });
});
