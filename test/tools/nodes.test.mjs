import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetRepoRootCache } from "../../dist/repo.js";
import {
  createNode,
  getNode,
  listNodes,
  updateNodeFile,
} from "../../dist/tools/nodes.js";

let tempRepo;

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-nodes-"));
  await mkdir(path.join(tempRepo, "nodes"), { recursive: true });
  await mkdir(path.join(tempRepo, "workflows"), { recursive: true });
  await mkdir(path.join(tempRepo, "flow-id-to-label"), { recursive: true });
  process.env.BUILDSHIP_REPO = tempRepo;
  resetRepoRootCache();
});

after(async () => {
  await rm(tempRepo, { recursive: true, force: true });
});

describe("Node tools — valid operations", () => {
  it("creates a node with inputs and required fields", async () => {
    const result = await createNode({
      id: "greet-user",
      label: "Greet User",
      description: "Returns a personalized greeting.",
      inputs: {
        name: { type: "string", title: "Name", description: "Person's name." },
        loud: { type: "boolean", title: "Loud", description: "YELL if true." },
      },
      required: ["name"],
      output: { type: "string", title: "Greeting" },
      mainTs: 'export default async function ({ name }: NodeInputs): NodeOutput {\n  return `Hello, ${name}`;\n}\n',
    });
    assert.equal(result.nodeId, "greet-user");
    assert.equal(result.version, "1.0.0");
    assert.ok(result.files.includes("main.ts"));
    assert.ok(result.files.includes("schema.json"));
    assert.ok(result.files.includes("inputs.json"));
    assert.ok(result.files.includes("output.json"));
    assert.ok(result.files.includes("meta.json"));
  });

  it("gets the created node with all files", async () => {
    const result = await getNode({ id: "greet-user" });
    assert.equal(result.id, "greet-user");
    assert.equal(result.version, "1.0.0");
    assert.ok(result.availableVersions.includes("1.0.0"));
    assert.equal(result.schema.label, "Greet User");
    assert.equal(result.inputs.type, "object");
    assert.ok(result.mainTs.includes("Hello"));
  });

  it("lists nodes and finds the created one", async () => {
    const result = await listNodes({});
    assert.ok(result.total >= 1);
    const found = result.nodes.find((n) => n.id === "greet-user");
    assert.ok(found, "created node should appear in list");
    assert.ok(found.versions.includes("1.0.0"));
    assert.equal(found.label, "Greet User");
  });

  it("updates main.ts content", async () => {
    const newContent = 'export default async function (): NodeOutput {\n  return "updated";\n}\n';
    const result = await updateNodeFile({
      id: "greet-user",
      version: "1.0.0",
      file: "main.ts",
      content: newContent,
    });
    assert.equal(result.updated, true);

    const node = await getNode({ id: "greet-user" });
    assert.ok(node.mainTs.includes("updated"));
  });

  it("updates inputs.json with valid JSON", async () => {
    const result = await updateNodeFile({
      id: "greet-user",
      version: "1.0.0",
      file: "inputs.json",
      content: JSON.stringify({ type: "object", properties: {}, required: [] }),
    });
    assert.equal(result.updated, true);
  });
});

describe("Node tools — overwrite protection", () => {
  it("refuses to create existing node without overwrite", async () => {
    await assert.rejects(
      createNode({ id: "greet-user", label: "Duplicate" }),
      /already exists/,
    );
  });

  it("creates with overwrite: true replaces content", async () => {
    const result = await createNode({
      id: "greet-user",
      label: "Greet User v2",
      overwrite: true,
    });
    assert.equal(result.nodeId, "greet-user");

    const node = await getNode({ id: "greet-user" });
    assert.equal(node.schema.label, "Greet User v2");
  });
});

describe("Node tools — JSON validation", () => {
  it("rejects invalid JSON for inputs.json update", async () => {
    await assert.rejects(
      updateNodeFile({
        id: "greet-user",
        version: "1.0.0",
        file: "inputs.json",
        content: "{ invalid json",
      }),
      /not valid JSON/,
    );
  });

  it("rejects invalid JSON for schema.json update", async () => {
    await assert.rejects(
      updateNodeFile({
        id: "greet-user",
        version: "1.0.0",
        file: "schema.json",
        content: '{"broken": ',
      }),
      /not valid JSON/,
    );
  });
});

describe("Node tools — path traversal protection", () => {
  it("blocks getNode with ../../etc id", async () => {
    await assert.rejects(
      getNode({ id: "../../etc" }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks getNode with absolute path id (treated as relative, not found)", async () => {
    await assert.rejects(
      getNode({ id: "/etc/passwd" }),
      /Node not found/,
    );
  });

  it("blocks updateNodeFile with ../../etc id", async () => {
    await assert.rejects(
      updateNodeFile({
        id: "../../etc",
        version: "1.0.0",
        file: "main.ts",
        content: "evil",
      }),
      /Path escapes the allowed directory/,
    );
  });

  it("blocks updateNodeFile with nested traversal id", async () => {
    await assert.rejects(
      updateNodeFile({
        id: "foo/../../../etc",
        version: "1.0.0",
        file: "main.ts",
        content: "evil",
      }),
      /Path escapes the allowed directory/,
    );
  });
});
