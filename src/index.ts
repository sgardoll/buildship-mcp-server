#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError, type z } from "zod";
import { zodToJsonSchema } from "./jsonSchema.js";
import { resolveRepoRoot, withRepoMutationLock } from "./repo.js";
import { SyncToGitSchema, syncToGit } from "./tools/git.js";
import {
  CreateNodeInputSchema,
  createNode,
  GetNodeSchema,
  getNode,
  ListNodesSchema,
  listNodes,
  UpdateNodeFileSchema,
  updateNodeFile,
} from "./tools/nodes.js";
import { ValidateDeploymentSchema, validateDeployment } from "./tools/validation.js";
import {
  AddNodeToWorkflowSchema,
  addNodeToWorkflow,
  CreateWorkflowSchema,
  createWorkflow,
  GetLabelSchema,
  GetWorkflowSchema,
  getLabel,
  getWorkflow,
  ListWorkflowsSchema,
  listWorkflows,
  SetLabelSchema,
  setLabel,
} from "./tools/workflows.js";
import { CheckForUpdatesSchema, checkForUpdates } from "./updates.js";
import { SERVER_VERSION } from "./version.js";

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  annotations: ToolAnnotations;
  handler: (input: unknown) => Promise<unknown>;
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const LOCAL_MUTATION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const TOOLS: ToolDef[] = [
  {
    name: "check_for_updates",
    description:
      "Check the latest public GitHub release against the installed server version. Returns update availability, release link, and manual update instructions. Results are cached; force: true refreshes them. No files are changed and network failures do not prevent other tools from running.",
    schema: CheckForUpdatesSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: checkForUpdates,
  },
  {
    name: "list_nodes",
    description:
      "List BuildShip custom nodes in the repo. Optional `search` filters by id substring.",
    schema: ListNodesSchema,
    annotations: READ_ONLY,
    handler: listNodes,
  },
  {
    name: "get_node",
    description:
      "Read a node's schema.json, inputs.json, output.json, and main.ts. Defaults to the highest version when `version` is omitted.",
    schema: GetNodeSchema,
    annotations: READ_ONLY,
    handler: getNode,
  },
  {
    name: "create_node",
    description:
      "Create a new custom node directory under nodes/<id>/<version>/ with schema.json, inputs.json, output.json, meta.json, and main.ts. Also writes a flow-id-to-label entry.",
    schema: CreateNodeInputSchema,
    annotations: LOCAL_MUTATION,
    handler: createNode,
  },
  {
    name: "update_node_file",
    description:
      "Replace one of main.ts, inputs.json, output.json, or schema.json for an existing node version. JSON files are validated before writing.",
    schema: UpdateNodeFileSchema,
    annotations: LOCAL_MUTATION,
    handler: updateNodeFile,
  },
  {
    name: "list_workflows",
    description: "List BuildShip workflows in the repo with their id, name, and description.",
    schema: ListWorkflowsSchema,
    annotations: READ_ONLY,
    handler: listWorkflows,
  },
  {
    name: "get_workflow",
    description:
      "Read a workflow's schema.json, meta.json, nodes.json, inputs.json, output.json, and triggers.json by folder name.",
    schema: GetWorkflowSchema,
    annotations: READ_ONLY,
    handler: getWorkflow,
  },
  {
    name: "create_workflow",
    description:
      "Create a workflow with local structural and TypeScript preflight checks. Embeds custom/control node definitions, a REST v2 trigger, and one Flow Output node; restores prior files if validation fails. Does not deploy or verify BuildShip runtime acceptance.",
    schema: CreateWorkflowSchema,
    annotations: LOCAL_MUTATION,
    handler: createWorkflow,
  },
  {
    name: "add_node_to_workflow",
    description:
      "Materialize a custom/control node into a workflow, validate references and schemas locally, and restore prior workflow files on failure.",
    schema: AddNodeToWorkflowSchema,
    annotations: LOCAL_MUTATION,
    handler: addNodeToWorkflow,
  },
  {
    name: "set_flow_label",
    description: "Write or overwrite a flow-id-to-label/<id>.txt file with a human-readable label.",
    schema: SetLabelSchema,
    annotations: LOCAL_MUTATION,
    handler: setLabel,
  },
  {
    name: "get_flow_label",
    description: "Read the human-readable label associated with a workflow or node id.",
    schema: GetLabelSchema,
    annotations: READ_ONLY,
    handler: getLabel,
  },
  {
    name: "validate_deployment",
    description:
      "Run local deployment preflight for a node, workflow, or the complete repository: required files, JSON/schema checks, main.ts type-checking, references, bindings, and trigger/node serialization. Does not verify dependency availability, deployment, or runtime behavior in BuildShip.",
    schema: ValidateDeploymentSchema,
    annotations: READ_ONLY,
    handler: validateDeployment,
  },
  {
    name: "sync_to_git",
    description:
      "Validate changed BuildShip artifacts locally, stage only BuildShip-managed paths, commit, and optionally push to the configured Git remote. A push can trigger BuildShip GitHub Integration; deployment success is not verified.",
    schema: SyncToGitSchema,
    annotations: { ...LOCAL_MUTATION, openWorldHint: true },
    handler: syncToGit,
  },
];

async function main() {
  // Informational CLI commands work without a configured BuildShip repository.
  if (process.argv.includes("--version")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (process.argv.includes("--check-updates")) {
    process.stdout.write(`${JSON.stringify(await checkForUpdates({}), null, 2)}\n`);
    return;
  }
  // `--check` resolves the repo root, prints it, and exits — for sanity-testing
  // an install without launching a client.
  if (process.argv.includes("--check")) {
    try {
      const root = await resolveRepoRoot();
      process.stdout.write(`BuildShip repo: ${root}\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[buildship-mcp] ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  // Eagerly resolve the repo root so we fail fast with a clear error if it's missing.
  await resolveRepoRoot().catch((err: Error) => {
    process.stderr.write(`[buildship-mcp] ${err.message}\n`);
    process.exit(1);
  });

  const server = new Server(
    { name: "buildship-mcp", version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${req.params.name}`);
    }

    try {
      // Readers share the mutation lock so a concurrent call cannot expose
      // partially written files while a transaction is awaiting validation.
      const execute = () => tool.handler(req.params.arguments ?? {});
      // Update checks do not access repository state and should not hold up
      // local operations while waiting for GitHub.
      const result =
        tool.name === "check_for_updates" ? await execute() : await withRepoMutationLock(execute);
      const pushFailed =
        tool.name === "sync_to_git" &&
        typeof result === "object" &&
        result !== null &&
        "pushError" in result &&
        typeof result.pushError === "string";
      return {
        ...(pushFailed ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message =
        err instanceof ZodError
          ? `Invalid input for ${tool.name}: ${err.errors.map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`).join("; ")}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[buildship-mcp] ready\n");
}

main().catch((err) => {
  process.stderr.write(`[buildship-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
