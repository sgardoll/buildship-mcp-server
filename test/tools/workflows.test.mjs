import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetRepoRootCache } from "../../dist/repo.js";
import {
  addNodeToWorkflow,
  createWorkflow,
  getLabel,
  getWorkflow,
  listWorkflows,
  setLabel,
} from "../../dist/tools/workflows.js";

let tempRepo;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-wf-"));
  await mkdir(path.join(tempRepo, "nodes"), { recursive: true });
  await mkdir(path.join(tempRepo, "workflows"), { recursive: true });
  await mkdir(path.join(tempRepo, "flow-id-to-label"), { recursive: true });
  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
});

describe("Workflow tools — valid operations", () => {
  let createdFolder;

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
    const _first = await createWorkflow({ name: "overwrite-test-2" });
    const result = await createWorkflow({
      name: "overwrite-test-2",
      description: "Replaced",
      overwrite: true,
    });
    const wf = await getWorkflow({ folder: result.folder });
    assert.equal(wf.schema.description, "Replaced");
  });
});

describe("Workflow tools — path traversal protection", () => {
  it("blocks getWorkflow with ../../etc folder", async () => {
    await assert.rejects(
      getWorkflow({ folder: "../../etc" }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks getWorkflow with absolute path folder (treated as relative, not found)", async () => {
    await assert.rejects(getWorkflow({ folder: "/etc" }), /Workflow not found/);
  });

  it("blocks addNodeToWorkflow with ../../etc folder", async () => {
    await assert.rejects(
      addNodeToWorkflow({
        folder: "../../etc",
        node: { type: "script" },
      }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks setLabel with ../../etc id", async () => {
    await assert.rejects(
      setLabel({ id: "../../etc/evil", label: "evil" }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks getLabel with ../../etc id", async () => {
    await assert.rejects(
      getLabel({ id: "../../etc/passwd" }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks setLabel with .ssh path (authorized_keys attack)", async () => {
    await assert.rejects(
      setLabel({
        id: "../../.ssh/authorized_keys",
        label: "ssh-ed25519 AAAA... attacker@host",
      }),
      /Path escapes the allowed directory/,
    );
  });
});
