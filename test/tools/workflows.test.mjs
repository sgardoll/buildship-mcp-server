import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import { createNode } from "../../dist/tools/nodes.js";
import {
  addNodeToWorkflow,
  createWorkflow,
  getLabel,
  getWorkflow,
  listWorkflows,
  setLabel,
} from "../../dist/tools/workflows.js";

let tempRepo;
let createdFolder;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-wf-"));
  await mkdir(path.join(tempRepo, "nodes"), { recursive: true });
  await mkdir(path.join(tempRepo, "workflows"), { recursive: true });
  await mkdir(path.join(tempRepo, "flow-id-to-label"), { recursive: true });
  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();
  await createNode({
    id: "greet-user",
    label: "Greet User",
    inputs: { name: { type: "string" } },
    output: { type: "string" },
    mainTs:
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional generated TypeScript template literal
      "export default async function ({ name }: NodeInputs): Promise<NodeOutput> {\n  return `Hello ${name}`;\n}\n",
  });
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
});

describe("Workflow tools — valid operations", () => {
  it("creates a workflow with REST trigger", async () => {
    const result = await createWorkflow({
      name: "test-workflow",
      description: "A test workflow",
      trigger: { method: "POST", path: "/test" },
      nodes: [
        {
          type: "script",
          label: "Test Step",
          nodeId: "greet-user",
          version: "1.0.0",
        },
      ],
    });
    assert.ok(result.folder);
    assert.ok(result.workflowId);
    assert.ok(result.triggerId);
    assert.ok(result.flowOutputId);
    assert.ok(result.nodeCount >= 2); // user node + Flow Output
    createdFolder = result.folder;

    const workflow = await getWorkflow({ folder: createdFolder });
    const trigger = workflow.triggers[0];
    assert.equal(trigger.type, "http-v2");
    assert.equal(trigger._libRef.version, "2.0.2");
    assert.ok(trigger._libRef.integrity);
    assert.ok(trigger._libRef.src);
    assert.ok(trigger.data);
    assert.ok(trigger.response);
    assert.ok(trigger.lifeCycleFunctions.includes("onExecution"));
    assert.ok(trigger.script.includes("onExecution"));
    assert.ok(trigger.script.includes("requestPath: request.path"));
    assert.equal(trigger.script.includes("    path: request.path"), false);
    const embedded = workflow.nodes.find((node) => node.id !== result.flowOutputId);
    assert.ok(embedded.script);
    assert.ok(embedded.inputs);
    assert.ok(embedded.output);
    assert.equal("nodeId" in embedded, false);
  });

  it("gets the created workflow with all files", async () => {
    const result = await getWorkflow({ folder: createdFolder });
    assert.equal(result.folder, createdFolder);
    assert.ok(result.schema);
    assert.ok(result.meta);
    assert.ok(result.nodes);
    assert.ok(result.inputs);
    assert.ok(result.output);
    assert.ok(result.triggers);
    assert.equal(result.schema.name, "test-workflow");
  });

  it("lists workflows and finds the created one", async () => {
    const result = await listWorkflows({});
    assert.ok(result.total >= 1);
    const found = result.workflows.find((w) => w.folder === createdFolder);
    assert.ok(found);
    assert.equal(found.name, "test-workflow");
  });

  it("adds a node to the workflow", async () => {
    const result = await addNodeToWorkflow({
      folder: createdFolder,
      node: {
        type: "script",
        label: "Extra Step",
        nodeId: "greet-user",
      },
    });
    assert.ok(result.addedId);
    assert.ok(result.totalNodes >= 3); // original 2 + new one
  });

  it("sets and gets a flow label", async () => {
    await setLabel({ id: "test-label-id", label: "Test Label" });
    const result = await getLabel({ id: "test-label-id" });
    assert.equal(result.label, "Test Label");
    assert.equal(result.exists, true);
  });

  it("returns exists:false for missing label", async () => {
    const result = await getLabel({ id: "nonexistent-id" });
    assert.equal(result.exists, false);
    assert.equal(result.label, null);
  });
});

describe("Workflow tools — overwrite protection", () => {
  it("refuses to create existing workflow without overwrite", async () => {
    // Use folderName to force the same folder for both calls
    await createWorkflow({ name: "overwrite-test", folderName: "overwrite-test-X1Y2" });
    await assert.rejects(
      createWorkflow({ name: "overwrite-test", folderName: "overwrite-test-X1Y2" }),
      /already exists/,
    );
  });

  it("creates with overwrite: true replaces workflow", async () => {
    const first = await createWorkflow({
      name: "overwrite-test-2",
      folderName: "overwrite-test-2-X1Y2",
    });
    const result = await createWorkflow({
      name: "overwrite-test-2",
      folderName: first.folder,
      description: "Replaced",
      overwrite: true,
    });
    const wf = await getWorkflow({ folder: result.folder });
    assert.equal(wf.schema.description, "Replaced");
  });
});

describe("Workflow tools — path traversal protection", () => {
  it("blocks getWorkflow with ../../etc folder", async () => {
    await assert.rejects(getWorkflow({ folder: "../../etc" }), /Invalid/);
  });

  it("rejects absolute workflow folders at schema validation", async () => {
    await assert.rejects(getWorkflow({ folder: "/etc" }), /Invalid/);
  });

  it("blocks addNodeToWorkflow with ../../etc folder", async () => {
    await assert.rejects(
      addNodeToWorkflow({
        folder: "../../etc",
        node: { type: "script", nodeId: "greet-user" },
      }),
      /Invalid/,
    );
  });

  it("blocks setLabel with ../../etc id", async () => {
    await assert.rejects(setLabel({ id: "../../etc/evil", label: "evil" }), /Invalid/);
  });

  it("blocks getLabel with ../../etc id", async () => {
    await assert.rejects(getLabel({ id: "../../etc/passwd" }), /Invalid/);
  });

  it("blocks setLabel with .ssh path (authorized_keys attack)", async () => {
    await assert.rejects(
      setLabel({
        id: "../../.ssh/authorized_keys",
        label: "ssh-ed25519 AAAA... attacker@host",
      }),
      /Invalid/,
    );
  });

  it("rejects malformed REST endpoint paths", async () => {
    await assert.rejects(
      createWorkflow({
        name: "bad rest path",
        trigger: { path: "missing-leading-slash" },
      }),
      /REST path must start with/,
    );
  });
});

describe("Workflow tools — semantic validation and rollback", () => {
  it("rejects the non-deployable library pseudo-type", async () => {
    await assert.rejects(
      createWorkflow({
        name: "library-node",
        folderName: "library-node-X1Y2",
        nodes: [{ type: "library", nodeId: "greet-user" }],
      }),
      /Invalid enum value/,
    );
  });

  it("tracks nested control-node ids and values as real workflow references", async () => {
    const branchId = "44444444-4444-4444-8444-444444444444";
    const nestedOutputId = "55555555-5555-4555-8555-555555555555";
    const result = await createWorkflow({
      name: "nested control",
      folderName: "nested-control-X1Y2",
      nodes: [
        {
          id: branchId,
          type: "branch",
          definition: {
            condition: true,
            // biome-ignore lint/suspicious/noThenProperty: BuildShip branch schema requires `then`
            then: [{ id: nestedOutputId, type: "output", label: "Nested Output" }],
            else: [],
          },
          nestedValues: {
            [nestedOutputId]: {
              _$bsCacheMaxAge_: 0,
              _$bsStatusCode_: "200",
              _$lastNodeOutput_: {},
            },
          },
        },
      ],
    });
    const workflow = await getWorkflow({ folder: result.folder });
    assert.ok(nestedOutputId in workflow.schema.nodeValues);
    assert.ok(nestedOutputId in workflow.meta.nodeIdToLabel);
  });

  it("rejects incompatible bindings and removes all newly written workflow files", async () => {
    await createNode({
      id: "string-producer",
      label: "String Producer",
      output: { type: "object", properties: { result: { type: "string" } } },
      mainTs:
        'export default async function (): Promise<NodeOutput> {\n  return { result: "ok" };\n}\n',
    });
    await createNode({
      id: "number-consumer",
      label: "Number Consumer",
      inputs: { count: { type: "number" } },
      required: ["count"],
      output: { type: "object" },
      mainTs:
        "export default async function ({ count }: NodeInputs): Promise<NodeOutput> {\n  return { count };\n}\n",
    });
    const producerId = "11111111-1111-4111-8111-111111111111";
    const consumerId = "22222222-2222-4222-8222-222222222222";
    const folder = "incompatible-binding-X1Y2";
    await assert.rejects(
      createWorkflow({
        name: "incompatible binding",
        folderName: folder,
        nodes: [
          { id: producerId, nodeId: "string-producer" },
          {
            id: consumerId,
            nodeId: "number-consumer",
            values: { count: { _$keys_: [producerId, "result"] } },
          },
        ],
      }),
      /incompatible binding/,
    );
    await assert.rejects(access(path.join(tempRepo, "workflows", folder)));
  });

  it("rejects missing required node input bindings", async () => {
    const folder = "missing-required-X1Y2";
    await assert.rejects(
      createWorkflow({
        name: "missing required",
        folderName: folder,
        nodes: [{ nodeId: "number-consumer" }],
      }),
      /required input .*count.* has no binding or default/,
    );
    await assert.rejects(access(path.join(tempRepo, "workflows", folder)));
  });

  it("does not mask malformed required workflow JSON", async () => {
    const nodesPath = path.join(tempRepo, "workflows", createdFolder, "nodes.json");
    const original = await readFile(nodesPath, "utf8");
    await writeFile(nodesPath, "{ malformed", "utf8");
    await assert.rejects(getWorkflow({ folder: createdFolder }), /Malformed JSON/);
    await writeFile(nodesPath, original, "utf8");
  });
});
