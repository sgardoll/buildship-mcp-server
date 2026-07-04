#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodError, type z } from "zod";
import { zodToJsonSchema } from "./jsonSchema.js";
import { resolveRepoRoot } from "./repo.js";
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

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_nodes",
    description:
      "List BuildShip custom nodes in the repo. Optional `search` filters by id substring.",
    schema: ListNodesSchema,
    handler: listNodes,
  },
  {
    name: "get_node",
    description:
      "Read a node's schema.json, inputs.json, output.json, and main.ts. Defaults to the highest version when `version` is omitted.",
    schema: GetNodeSchema,
    handler: getNode,
  },
  {
    name: "create_node",
    description:
      "Create a new custom node directory under nodes/<id>/<version>/ with schema.json, inputs.json, output.json, meta.json, and main.ts. Also writes a flow-id-to-label entry.",
    schema: CreateNodeInputSchema,
    handler: createNode,
  },
  {
    name: "update_node_file",
    description:
      "Replace one of main.ts, inputs.json, output.json, or schema.json for an existing node version. JSON files are validated before writing.",
    schema: UpdateNodeFileSchema,
    handler: updateNodeFile,
  },
  {
    name: "list_workflows",
    description: "List BuildShip workflows in the repo with their id, name, and description.",
    schema: ListWorkflowsSchema,
    handler: listWorkflows,
  },
  {
    name: "get_workflow",
    description:
      "Read a workflow's schema.json, meta.json, nodes.json, inputs.json, output.json, and triggers.json by folder name.",
    schema: GetWorkflowSchema,
    handler: getWorkflow,
  },
  {
    name: "create_workflow",
    description:
      "Create a new workflow directory with schema.json, meta.json, nodes.json, inputs.json, output.json, and triggers.json. Optionally seeds a REST trigger and a list of node entries; always appends a Flow Output node.",
    schema: CreateWorkflowSchema,
    handler: createWorkflow,
  },
  {
    name: "add_node_to_workflow",
    description:
      "Append a node entry to an existing workflow's nodes.json (and optionally update meta.nodeIdToLabel and schema.nodeValues).",
    schema: AddNodeToWorkflowSchema,
    handler: addNodeToWorkflow,
  },
  {
    name: "set_flow_label",
    description: "Write or overwrite a flow-id-to-label/<id>.txt file with a human-readable label.",
    schema: SetLabelSchema,
    handler: setLabel,
  },
  {
    name: "get_flow_label",
    description: "Read the human-readable label associated with a workflow or node id.",
    schema: GetLabelSchema,
    handler: getLabel,
  },
  {
    name: "sync_to_git",
    description:
      "Stage, commit, and optionally push changes in the BuildShip repo's git working tree. Use after creating or updating nodes/workflows to sync changes to GitHub via BuildShip's GitHub Integration.",
    schema: SyncToGitSchema,
    handler: syncToGit,
  },
];

async function main() {
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
    { name: "buildship-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }

    try {
      const result = await tool.handler(req.params.arguments ?? {});
      return {
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
