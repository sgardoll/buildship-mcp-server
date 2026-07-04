import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  labelsDir,
  listDirs,
  pathExists,
  readJson,
  readText,
  safeJoin,
  workflowsDir,
  writeJson,
  writeText,
} from "../repo.js";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const NODE_TYPES = ["script", "output", "branch", "loop", "trigger", "library"] as const;

function shortSuffix(): string {
  // Buildship-style 4-char suffix used in workflow folder names like `auth-byok-registration-OmLH`.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function generateWorkflowId(): string {
  // Generates a 20-char id similar to the existing repo (e.g. `HceqKhqYlr6X0RXBOmLH`).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const WorkflowNodeSchema = z.object({
  id: z.string().uuid().optional().describe("UUID of the node entry (auto-generated if omitted)."),
  label: z.string().optional(),
  type: z.enum(NODE_TYPES).default("script"),
  nodeId: z.string().optional().describe("Library/custom node id this entry references."),
  version: z.string().regex(SEMVER_RE).optional(),
  values: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Entry for schema.json nodeValues."),
});

export type WorkflowNodeInput = z.infer<typeof WorkflowNodeSchema>;

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).describe("Human-readable workflow name (e.g. `auth/refresh-session`)."),
  folderName: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]+-[A-Za-z0-9]{4}$/)
    .optional()
    .describe("Override directory name; default `<slug>-<4charSuffix>`."),
  workflowId: z
    .string()
    .min(10)
    .max(40)
    .optional()
    .describe("Override the 20-char workflow id used in schema.json and labels."),
  description: z.string().default(""),
  trigger: z
    .object({
      type: z.literal("rest").default("rest"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
      path: z.string().default("/"),
      requestContentType: z
        .enum(["application/json", "application/x-www-form-urlencoded", "text/plain"])
        .default("application/json"),
    })
    .optional(),
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

function buildRestTriggerEntry(
  triggerId: string,
  cfg: NonNullable<CreateWorkflowInput["trigger"]>,
) {
  return [
    {
      id: triggerId,
      type: "http-v2",
      label: "REST API Call",
      _libRef: {
        libNodeRefId: "@buildship/http-v2",
        libType: "public",
        version: "2.0.0",
      },
      config: {
        type: "object",
        properties: {
          path: { type: "string", title: "Path", default: cfg.path },
          method: { type: "string", title: "Method", default: cfg.method },
          requestContentType: {
            type: "string",
            title: "Request Content Type",
            default: cfg.requestContentType,
          },
        },
        required: ["path", "method"],
      },
    },
  ];
}

export async function createWorkflow(raw: unknown) {
  const input = CreateWorkflowSchema.parse(raw);
  const slug = slugify(input.name);
  const folder = input.folderName ?? `${slug}-${shortSuffix()}`;
  const wfId = input.workflowId ?? generateWorkflowId();

  const root = await workflowsDir();
  const dir = safeJoin(root, folder);
  if ((await pathExists(dir)) && !input.overwrite) {
    throw new Error(`Workflow folder already exists: ${folder}. Pass overwrite: true to replace.`);
  }

  const triggerId = input.trigger ? randomUUID() : null;
  const flowOutputId = buildFlowOutputNodeId();

  const nodesArray: Array<Record<string, unknown>> = [];
  const nodeIdToLabel: Record<string, string> = {};
  const nodeValues: Record<string, Record<string, unknown>> = {};

  for (const n of input.nodes) {
    const id = n.id ?? randomUUID();
    const entry: Record<string, unknown> = { id, type: n.type };
    if (n.label) entry.label = n.label;
    if (n.nodeId) entry.nodeId = n.nodeId;
    if (n.version) entry.version = n.version;
    nodesArray.push(entry);
    if (n.label) nodeIdToLabel[id] = n.label;
    if (n.values) nodeValues[id] = n.values;
  }

  // Always include a Flow Output node so the workflow has a terminal step.
  nodesArray.push({ id: flowOutputId, label: "Flow Output", type: "output" });
  nodeIdToLabel[flowOutputId] = `flow-output-${flowOutputId.slice(-4)}`;
  nodeValues[flowOutputId] = {
    _$bsCacheMaxAge_: 0,
    _$bsStatusCode_: "200",
    _$lastNodeOutput_: {},
  };

  if (triggerId && input.trigger) {
    nodeIdToLabel[triggerId] = `rest-api-call-${triggerId.slice(-4)}`;
    nodeValues[triggerId] = {
      "config.method": input.trigger.method,
      "config.path": input.trigger.path,
      "config.requestContentType": input.trigger.requestContentType,
      "outputs.body": { _$keys_: ["output"] },
      "outputs.cacheMaxAge": { _$keys_: ["state", "_$bsCacheMaxAge_"] },
      "outputs.status": { _$keys_: ["state", "_$bsStatusCode_"] },
    };
  }

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

  const triggersJson =
    triggerId && input.trigger ? buildRestTriggerEntry(triggerId, input.trigger) : [];

  await writeJson(path.join(dir, "meta.json"), metaJson);
  await writeJson(path.join(dir, "schema.json"), schemaJson);
  await writeJson(path.join(dir, "nodes.json"), nodesArray);
  await writeJson(path.join(dir, "inputs.json"), inputsJson);
  await writeJson(path.join(dir, "output.json"), outputJson);
  await writeJson(path.join(dir, "triggers.json"), triggersJson);

  await writeText(safeJoin(await labelsDir(), `${wfId}.txt`), folder);

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
      ).catch(() => null);
      return {
        folder,
        id: schema?.id ?? null,
        name: schema?.name ?? null,
        description: schema?.description ?? null,
      };
    }),
  );

  return { total: filtered.length, returned: results.length, workflows: results };
}

export const GetWorkflowSchema = z.object({
  folder: z.string().min(1),
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
    schema: await readJson(path.join(dir, "schema.json")).catch(() => null),
    meta: await readJson(path.join(dir, "meta.json")).catch(() => null),
    nodes: await readJson(path.join(dir, "nodes.json")).catch(() => null),
    inputs: await readJson(path.join(dir, "inputs.json")).catch(() => null),
    output: await readJson(path.join(dir, "output.json")).catch(() => null),
    triggers: await readJson(path.join(dir, "triggers.json")).catch(() => null),
  };
}

export const AddNodeToWorkflowSchema = z.object({
  folder: z.string().min(1),
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
  const existing = await readJson<Array<Record<string, unknown>>>(nodesPath).catch(() => null);
  const nodes: Array<Record<string, unknown>> = existing ?? [];
  if (nodes.some((n) => n.id === id)) {
    throw new Error(`Node id ${id} already exists in workflow ${folder}.`);
  }
  const entry: Record<string, unknown> = { id, type: node.type };
  if (node.label) entry.label = node.label;
  if (node.nodeId) entry.nodeId = node.nodeId;
  if (node.version) entry.version = node.version;
  nodes.push(entry);
  await writeJson(nodesPath, nodes);

  if (node.label || node.values) {
    const metaPath = path.join(dir, "meta.json");
    const schemaPath = path.join(dir, "schema.json");
    const meta: Record<string, unknown> =
      (await readJson<Record<string, unknown>>(metaPath).catch(() => null)) ?? {};
    const schema: Record<string, unknown> =
      (await readJson<Record<string, unknown>>(schemaPath).catch(() => null)) ?? {};
    if (node.label) {
      const existingLabels = (meta.nodeIdToLabel ?? {}) as Record<string, string>;
      meta.nodeIdToLabel = { ...existingLabels, [id]: node.label };
      await writeJson(metaPath, meta);
    }
    if (node.values) {
      const existingValues = (schema.nodeValues ?? {}) as Record<string, Record<string, unknown>>;
      schema.nodeValues = { ...existingValues, [id]: node.values };
      await writeJson(schemaPath, schema);
    }
  }

  return { folder, addedId: id, totalNodes: nodes.length };
}

export const SetLabelSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Workflow id, node id, or UUID — used as the .txt filename in flow-id-to-label/."),
  label: z.string().min(1),
});

export async function setLabel(raw: unknown) {
  const { id, label } = SetLabelSchema.parse(raw);
  const file = safeJoin(await labelsDir(), `${id}.txt`);
  await writeText(file, label);
  return { id, label, file: path.basename(file) };
}

export const GetLabelSchema = z.object({ id: z.string().min(1) });

export async function getLabel(raw: unknown) {
  const { id } = GetLabelSchema.parse(raw);
  const file = safeJoin(await labelsDir(), `${id}.txt`);
  if (!(await pathExists(file))) {
    return { id, label: null, exists: false };
  }
  const label = (await readText(file)).trim();
  return { id, label, exists: true };
}
