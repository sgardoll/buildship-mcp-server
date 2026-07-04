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
  writeJson,
  writeText,
} from "../repo.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const DEFAULT_ICON_URL =
  "https://framerusercontent.com/images/kcxXJqIDlUecsc85vAP6hZM4.png";

const DEFAULT_MAIN_TS = `export default async function (
  { name }: NodeInputs,
  { logging }: NodeScriptOptions,
): NodeOutput {
  logging.log("Input Param 'name': ", name);
  return "Output: " + name;
}
`;

export const NodeInputPropertySchema = z
  .object({
    type: z
      .enum(["string", "number", "boolean", "object", "array", "integer"])
      .default("string"),
    title: z.string().optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    pattern: z.string().optional(),
    sensitive: z.boolean().optional(),
    index: z.number().optional(),
  })
  .passthrough();

export const CreateNodeInputSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(80)
    .regex(SLUG_RE, "id must be lowercase kebab-case (a-z, 0-9, hyphen)"),
  label: z.string().min(1),
  description: z.string().default(""),
  version: z.string().regex(SEMVER_RE).default("1.0.0"),
  type: z.enum(["script", "trigger"]).default("script"),
  iconUrl: z.string().url().optional(),
  dependencies: z.record(z.string(), z.string()).default({}),
  inputs: z.record(z.string(), NodeInputPropertySchema).default({}),
  required: z.array(z.string()).default([]),
  output: z
    .object({
      type: z.string().default("object"),
      title: z.string().optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).default({}),
    })
    .partial()
    .default({}),
  mainTs: z.string().optional(),
  overwrite: z.boolean().default(false),
});

export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;

function toInputsJson(input: CreateNodeInput) {
  const properties: Record<string, unknown> = {};
  let i = 0;
  for (const [key, raw] of Object.entries(input.inputs)) {
    const { sensitive, index, type, title, description, ...rest } = raw;
    properties[key] = {
      buildship: {
        index: index ?? i,
        sensitive: sensitive ?? false,
      },
      title: title ?? key,
      description: description ?? "",
      type: type ?? "string",
      ...rest,
    };
    i += 1;
  }
  return {
    type: "object",
    properties,
    required: input.required,
  };
}

function toOutputJson(input: CreateNodeInput) {
  return {
    buildship: {},
    type: input.output.type ?? "object",
    title: input.output.title ?? "output",
    description: input.output.description ?? "",
    properties: input.output.properties ?? {},
  };
}

function toSchemaJson(input: CreateNodeInput) {
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    type: input.type,
    version: input.version,
    dependencies: input.dependencies,
    meta: {
      id: input.id,
      name: input.label,
      description: input.description,
      icon: {
        type: "URL",
        url: input.iconUrl ?? DEFAULT_ICON_URL,
      },
    },
  };
}

export async function createNode(raw: unknown) {
  const input = CreateNodeInputSchema.parse(raw);
  const root = await nodesDir();
  const versionDir = safeJoin(root, input.id, input.version);

  if ((await pathExists(versionDir)) && !input.overwrite) {
    throw new Error(
      `Node ${input.id}@${input.version} already exists. Pass overwrite: true to replace, or bump the version.`,
    );
  }

  const files: Record<string, string> = {
    "meta.json": JSON.stringify({ gitIntegrationVersion: "v1" }, null, 2) + "\n",
    "schema.json": JSON.stringify(toSchemaJson(input), null, 2) + "\n",
    "inputs.json": JSON.stringify(toInputsJson(input), null, 2) + "\n",
    "output.json": JSON.stringify(toOutputJson(input), null, 2) + "\n",
    "main.ts": (input.mainTs ?? DEFAULT_MAIN_TS).endsWith("\n")
      ? (input.mainTs ?? DEFAULT_MAIN_TS)
      : (input.mainTs ?? DEFAULT_MAIN_TS) + "\n",
  };

  for (const [name, content] of Object.entries(files)) {
    await writeText(path.join(versionDir, name), content);
  }

  const labelFile = safeJoin(await labelsDir(), `${input.id}.txt`);
  if (!(await pathExists(labelFile))) {
    await writeText(labelFile, input.label);
  }

  return {
    nodeId: input.id,
    version: input.version,
    path: path.relative(path.dirname(root), versionDir),
    files: Object.keys(files),
  };
}

export const ListNodesSchema = z.object({
  search: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export async function listNodes(raw: unknown) {
  const { search, limit } = ListNodesSchema.parse(raw);
  const root = await nodesDir();
  const ids = await listDirs(root);
  const filtered = search
    ? ids.filter((id) => id.toLowerCase().includes(search.toLowerCase()))
    : ids;
  const sliced = filtered.slice(0, limit);

  const results = await Promise.all(
    sliced.map(async (id) => {
      const versions = await listDirs(path.join(root, id)).catch(() => []);
      let label: string | null = null;
      const latest = versions[versions.length - 1];
      if (latest) {
        try {
          const schema = await readJson<{ label?: string }>(
            path.join(root, id, latest, "schema.json"),
          );
          label = schema.label ?? null;
        } catch {
          /* schema may not exist */
        }
      }
      return { id, versions, latestVersion: latest ?? null, label };
    }),
  );

  return {
    total: filtered.length,
    returned: results.length,
    nodes: results,
  };
}

export const GetNodeSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(SEMVER_RE).optional(),
});

export async function getNode(raw: unknown) {
  const { id, version } = GetNodeSchema.parse(raw);
  const root = await nodesDir();
  const nodeDir = safeJoin(root, id);
  if (!(await pathExists(nodeDir))) {
    throw new Error(`Node not found: ${id}`);
  }

  const versions = await listDirs(nodeDir);
  if (versions.length === 0) {
    throw new Error(`Node ${id} has no version directories.`);
  }

  const v = version ?? versions[versions.length - 1];
  const versionDir = safeJoin(nodeDir, v);
  if (!(await pathExists(versionDir))) {
    throw new Error(`Version ${v} not found for node ${id}. Available: ${versions.join(", ")}`);
  }

  return {
    id,
    version: v,
    availableVersions: versions,
    schema: await readJson(path.join(versionDir, "schema.json")).catch(() => null),
    inputs: await readJson(path.join(versionDir, "inputs.json")).catch(() => null),
    output: await readJson(path.join(versionDir, "output.json")).catch(() => null),
    mainTs: await readText(path.join(versionDir, "main.ts")).catch(() => null),
  };
}

export const UpdateNodeFileSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(SEMVER_RE),
  file: z.enum(["main.ts", "inputs.json", "output.json", "schema.json"]),
  content: z.string().min(1),
});

export async function updateNodeFile(raw: unknown) {
  const { id, version, file, content } = UpdateNodeFileSchema.parse(raw);
  const root = await nodesDir();
  const versionDir = safeJoin(root, id, version);
  if (!(await pathExists(versionDir))) {
    throw new Error(`Node ${id}@${version} does not exist.`);
  }

  if (file !== "main.ts") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`${file} content is not valid JSON: ${(err as Error).message}`);
    }
    await writeJson(path.join(versionDir, file), parsed);
  } else {
    await writeText(path.join(versionDir, file), content);
  }

  return { id, version, file, updated: true };
}
