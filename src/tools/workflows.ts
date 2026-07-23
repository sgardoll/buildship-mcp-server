import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  labelsDir,
  listDirs,
  nodesDir,
  pathExists,
  readJson,
  readText,
  safeJoin,
  workflowsDir,
  writeFilesTransaction,
  writeText,
} from "../repo.js";
import { buildRestTrigger } from "../restTrigger.js";
import { assertDeploymentValid, validateNode, validateWorkflow } from "./validation.js";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const NODE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const WORKFLOW_FOLDER_RE = /^[a-z0-9][A-Za-z0-9-]*$/;
const LABEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const NODE_TYPES = [
  "script",
  "branch",
  "loop",
  "parallel",
  "switch",
  "legacy-switch",
  "set-variable",
  "call-workflow",
  "execute-agent",
  "trigger",
] as const;

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a random string of the given length using a CSPRNG. */
function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function shortSuffix(): string {
  // Buildship-style 4-char suffix used in workflow folder names like `auth-byok-registration-OmLH`.
  return randomString(4);
}

function generateWorkflowId(): string {
  // Generates a 20-char id similar to the existing repo (e.g. `HceqKhqYlr6X0RXBOmLH`).
  return randomString(20);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const WorkflowNodeSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .describe("UUID of the node entry (auto-generated if omitted)."),
    label: z.string().optional(),
    type: z.enum(NODE_TYPES).default("script"),
    nodeId: z
      .string()
      .regex(NODE_ID_RE)
      .optional()
      .describe("Custom node id to embed as a complete deployable script node."),
    version: z.string().regex(SEMVER_RE).optional(),
    definition: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Complete serialized BuildShip node definition for non-custom/control nodes."),
    values: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Entry for schema.json nodeValues."),
    nestedValues: z
      .record(z.string().uuid(), z.record(z.string(), z.unknown()))
      .default({})
      .describe("schema.nodeValues entries for nodes nested inside a control-node definition."),
  })
  .superRefine((node, ctx) => {
    if (!node.nodeId && !node.definition) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A workflow node requires either `nodeId` or a complete `definition`.",
      });
    }
    if (node.type !== "script" && node.nodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "`nodeId` can only materialize a custom script node; use `definition` for control nodes.",
      });
    }
  });

export type WorkflowNodeInput = z.infer<typeof WorkflowNodeSchema>;

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).describe("Human-readable workflow name (e.g. `auth/refresh-session`)."),
  folderName: z
    .string()
    .regex(WORKFLOW_FOLDER_RE)
    .optional()
    .describe("Override directory name; default `<slug>-<4charSuffix>`."),
  workflowId: z
    .string()
    .min(10)
    .max(40)
    .regex(LABEL_ID_RE)
    .optional()
    .describe("Override the 20-char workflow id used in schema.json and labels."),
  description: z.string().default(""),
  trigger: z
    .object({
      type: z.literal("rest").default("rest"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
      path: z
        .string()
        .regex(/^\/[^\s?#]*$/, "REST path must start with / and cannot contain whitespace, ? or #")
        .default("/"),
      requestContentType: z
        .enum(["application/json", "application/x-www-form-urlencoded", "text/plain"])
        .default("application/json"),
    })
    .default({}),
  nodes: z.array(WorkflowNodeSchema).default([]),
  inputs: z.record(z.string(), z.unknown()).default({}),
  output: z
    .record(z.string(), z.unknown())
    .default({ output: { buildship: { index: 0 }, title: "Output" } }),
  overwrite: z.boolean().default(false),
});

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;

function buildFlowOutputNodeId() {
  return randomUUID();
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function materializeWorkflowNode(
  node: WorkflowNodeInput,
  id: string,
): Promise<Record<string, unknown>> {
  if (node.definition) {
    const entry: Record<string, unknown> = { ...node.definition, id, type: node.type };
    if (node.label) entry.label = node.label;
    delete entry.nodeId;
    delete entry.version;
    delete entry.definition;
    delete entry.values;
    delete entry.nestedValues;
    return entry;
  }

  const nodeId = node.nodeId;
  if (!nodeId) throw new Error("A custom workflow node requires nodeId.");
  const root = await nodesDir();
  const customDir = safeJoin(root, nodeId);
  if (!(await pathExists(customDir))) throw new Error(`Custom node not found: ${nodeId}`);
  const versions = (await listDirs(customDir))
    .filter((version) => SEMVER_RE.test(version))
    .sort((a, b) => {
      const aa = a.split(".").map(Number);
      const bb = b.split(".").map(Number);
      return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
    });
  const version = node.version ?? versions.at(-1);
  if (!version || !versions.includes(version)) {
    throw new Error(
      `Version ${node.version ?? "(latest)"} not found for custom node ${nodeId}. Available: ${versions.join(", ")}`,
    );
  }
  assertDeploymentValid(await validateNode(nodeId, version));
  const versionDir = safeJoin(customDir, version);
  const [schemaRaw, inputs, output, script] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(versionDir, "schema.json")),
    readJson(path.join(versionDir, "inputs.json")),
    readJson(path.join(versionDir, "output.json")),
    readText(path.join(versionDir, "main.ts")),
  ]);
  return {
    id,
    type: schemaRaw.type ?? "script",
    label: node.label ?? schemaRaw.label ?? nodeId,
    description: schemaRaw.description ?? "",
    dependencies: schemaRaw.dependencies ?? {},
    meta: schemaRaw.meta ?? {},
    inputs,
    output,
    script,
  };
}

function collectSerializedNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const collected = [node];
  const visitSequence = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const child of value) {
      if (!child || typeof child !== "object" || Array.isArray(child)) continue;
      collected.push(...collectSerializedNodes(child as Record<string, unknown>));
    }
  };
  visitSequence(node.then);
  visitSequence(node.else);
  if (Array.isArray(node.nodes)) {
    visitSequence(node.nodes);
  } else if (node.nodes && typeof node.nodes === "object") {
    for (const sequence of Object.values(node.nodes)) visitSequence(sequence);
  }
  if (node.conditionSequences && typeof node.conditionSequences === "object") {
    for (const sequence of Object.values(node.conditionSequences)) visitSequence(sequence);
  }
  return collected;
}

export async function createWorkflow(raw: unknown) {
  const input = CreateWorkflowSchema.parse(raw);
  const slug = slugify(input.name);
  if (!slug) throw new Error("Workflow name must contain at least one letter or number.");
  const folder = input.folderName ?? `${slug}-${shortSuffix()}`;
  const wfId = input.workflowId ?? generateWorkflowId();

  const root = await workflowsDir();
  const dir = safeJoin(root, folder);
  if ((await pathExists(dir)) && !input.overwrite) {
    throw new Error(`Workflow folder already exists: ${folder}. Pass overwrite: true to replace.`);
  }

  const triggerId = randomUUID();
  const flowOutputId = buildFlowOutputNodeId();

  const nodesArray: Array<Record<string, unknown>> = [];
  const nodeIdToLabel: Record<string, string> = {};
  const nodeValues: Record<string, Record<string, unknown>> = {};

  for (const n of input.nodes) {
    const id = n.id ?? randomUUID();
    const entry = await materializeWorkflowNode(n, id);
    nodesArray.push(entry);
    for (const serializedNode of collectSerializedNodes(entry)) {
      const serializedId = serializedNode.id;
      if (typeof serializedId !== "string") continue;
      const serializedLabel = serializedNode.label;
      if (typeof serializedLabel === "string") nodeIdToLabel[serializedId] = serializedLabel;
      nodeValues[serializedId] =
        serializedId === id ? (n.values ?? {}) : (n.nestedValues[serializedId] ?? {});
    }
  }

  // Always include a Flow Output node so the workflow has a terminal step.
  nodesArray.push({ id: flowOutputId, label: "Flow Output", type: "output" });
  nodeIdToLabel[flowOutputId] = `flow-output-${flowOutputId.slice(-4)}`;
  nodeValues[flowOutputId] = {
    _$bsCacheMaxAge_: 0,
    _$bsStatusCode_: "200",
    _$lastNodeOutput_: {},
  };

  nodeIdToLabel[triggerId] = `rest-api-call-${triggerId.slice(-4)}`;
  nodeValues[triggerId] = {
    "config.method": input.trigger.method,
    "config.path": input.trigger.path,
    "config.requestContentType": input.trigger.requestContentType,
    "outputs.body": { _$keys_: ["output"] },
    "outputs.cacheMaxAge": { _$keys_: ["state", "_$bsCacheMaxAge_"] },
    "outputs.status": { _$keys_: ["state", "_$bsStatusCode_"] },
  };

  const schemaJson = {
    id: wfId,
    name: input.name,
    description: input.description,
    env: {},
    runtimeVersion: "v3",
    stickyNotes: {},
    testExamples: {},
    nodeValues,
    variables: {
      _$bsCacheMaxAge_: {
        buildship: { index: 0 },
        default: 0,
        title: "Flow Output Cache Time",
        type: "number",
      },
      _$bsStatusCode_: {
        buildship: { index: 0 },
        title: "Flow Output Status Code",
        type: "string",
      },
    },
  };

  const metaJson = {
    gitIntegrationVersion: "v1",
    hashVersion: "v1",
    nodeIdToLabel,
  };

  const inputsJson = {
    type: "object",
    properties: input.inputs,
    required: [],
  };

  const outputJson = {
    type: "object",
    required: [],
    properties: input.output,
  };

  const triggersJson = [buildRestTrigger(triggerId, input.trigger)];
  const labelFile = safeJoin(await labelsDir(), `${wfId}.txt`);
  await writeFilesTransaction(
    [
      { file: path.join(dir, "meta.json"), content: jsonContent(metaJson) },
      { file: path.join(dir, "schema.json"), content: jsonContent(schemaJson) },
      { file: path.join(dir, "nodes.json"), content: jsonContent(nodesArray) },
      { file: path.join(dir, "inputs.json"), content: jsonContent(inputsJson) },
      { file: path.join(dir, "output.json"), content: jsonContent(outputJson) },
      { file: path.join(dir, "triggers.json"), content: jsonContent(triggersJson) },
      { file: labelFile, content: `${folder}\n` },
    ],
    async () => assertDeploymentValid(await validateWorkflow(folder)),
  );

  return {
    folder,
    workflowId: wfId,
    triggerId,
    flowOutputId,
    nodeCount: nodesArray.length,
  };
}

export const ListWorkflowsSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export async function listWorkflows(raw: unknown) {
  const { search, limit } = ListWorkflowsSchema.parse(raw);
  const root = await workflowsDir();
  const folders = await listDirs(root);
  const filtered = search
    ? folders.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : folders;
  const sliced = filtered.slice(0, limit);

  const results = await Promise.all(
    sliced.map(async (folder) => {
      const schema = await readJson<{ id?: string; name?: string; description?: string }>(
        path.join(root, folder, "schema.json"),
      );
      return {
        folder,
        id: schema.id ?? null,
        name: schema.name ?? null,
        description: schema.description ?? null,
      };
    }),
  );

  return { total: filtered.length, returned: results.length, workflows: results };
}

export const GetWorkflowSchema = z.object({
  folder: z.string().regex(WORKFLOW_FOLDER_RE),
});

export async function getWorkflow(raw: unknown) {
  const { folder } = GetWorkflowSchema.parse(raw);
  const root = await workflowsDir();
  const dir = safeJoin(root, folder);
  if (!(await pathExists(dir))) {
    throw new Error(`Workflow not found: ${folder}`);
  }

  return {
    folder,
    schema: await readJson(path.join(dir, "schema.json")),
    meta: await readJson(path.join(dir, "meta.json")),
    nodes: await readJson(path.join(dir, "nodes.json")),
    inputs: await readJson(path.join(dir, "inputs.json")),
    output: await readJson(path.join(dir, "output.json")),
    triggers: await readJson(path.join(dir, "triggers.json")),
  };
}

export const AddNodeToWorkflowSchema = z.object({
  folder: z.string().regex(WORKFLOW_FOLDER_RE),
  node: WorkflowNodeSchema,
});

export async function addNodeToWorkflow(raw: unknown) {
  const { folder, node } = AddNodeToWorkflowSchema.parse(raw);
  const root = await workflowsDir();
  const dir = safeJoin(root, folder);
  if (!(await pathExists(dir))) {
    throw new Error(`Workflow not found: ${folder}`);
  }

  const id = node.id ?? randomUUID();

  const nodesPath = path.join(dir, "nodes.json");
  const nodes = await readJson<Array<Record<string, unknown>>>(nodesPath);
  if (!Array.isArray(nodes)) throw new Error(`${nodesPath} must contain a JSON array.`);
  if (nodes.some((n) => n.id === id)) {
    throw new Error(`Node id ${id} already exists in workflow ${folder}.`);
  }
  const entry = await materializeWorkflowNode(node, id);
  nodes.push(entry);
  const serializedNodes = collectSerializedNodes(entry);

  const metaPath = path.join(dir, "meta.json");
  const schemaPath = path.join(dir, "schema.json");
  const meta = await readJson<Record<string, unknown>>(metaPath);
  const schema = await readJson<Record<string, unknown>>(schemaPath);
  const existingLabels =
    meta.nodeIdToLabel === undefined ? {} : (meta.nodeIdToLabel as Record<string, string>);
  for (const serializedNode of serializedNodes) {
    if (typeof serializedNode.id === "string" && typeof serializedNode.label === "string") {
      existingLabels[serializedNode.id] = serializedNode.label;
    }
  }
  meta.nodeIdToLabel = existingLabels;
  const existingValues =
    schema.nodeValues === undefined
      ? {}
      : (schema.nodeValues as Record<string, Record<string, unknown>>);
  for (const serializedNode of serializedNodes) {
    if (typeof serializedNode.id !== "string") continue;
    existingValues[serializedNode.id] =
      serializedNode.id === id ? (node.values ?? {}) : (node.nestedValues[serializedNode.id] ?? {});
  }
  schema.nodeValues = existingValues;

  await writeFilesTransaction(
    [
      { file: nodesPath, content: jsonContent(nodes) },
      { file: metaPath, content: jsonContent(meta) },
      { file: schemaPath, content: jsonContent(schema) },
    ],
    async () => assertDeploymentValid(await validateWorkflow(folder)),
  );

  return { folder, addedId: id, totalNodes: nodes.length };
}

export const SetLabelSchema = z.object({
  id: z
    .string()
    .regex(LABEL_ID_RE)
    .describe("Workflow id, node id, or UUID — used as the .txt filename in flow-id-to-label/."),
  label: z.string().min(1),
});

export async function setLabel(raw: unknown) {
  const { id, label } = SetLabelSchema.parse(raw);
  const file = safeJoin(await labelsDir(), `${id}.txt`);
  await writeText(file, label);
  return { id, label, file: path.basename(file) };
}

export const GetLabelSchema = z.object({ id: z.string().regex(LABEL_ID_RE) });

export async function getLabel(raw: unknown) {
  const { id } = GetLabelSchema.parse(raw);
  const file = safeJoin(await labelsDir(), `${id}.txt`);
  if (!(await pathExists(file))) {
    return { id, label: null, exists: false };
  }
  const label = (await readText(file)).trim();
  return { id, label, exists: true };
}
