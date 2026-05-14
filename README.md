# BuildShip MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent create and edit BuildShip **custom nodes** and **workflows** by writing into the file layout that this repository expects:

```
nodes/<id>/<version>/{schema,inputs,output,meta}.json + main.ts
workflows/<folder>/{schema,meta,nodes,inputs,output,triggers}.json
flow-id-to-label/<id>.txt
```

The server enforces the conventions documented in [`AGENTS.md`](https://github.com/sgardoll/buildship/blob/main/AGENTS.md): every new node ships the five required files, every new workflow ships the six required files plus a `flow-id-to-label/<workflowId>.txt` entry, and existing files are validated as JSON before they are overwritten.

## Setup

```bash
npm install
npm run build      # emits dist/index.js
```

The compiled entrypoint is `dist/index.js` and speaks MCP over stdio.

## Run it

The server auto-locates the BuildShip repo by walking up from its own directory or `cwd`. To force a specific path, set:

```bash
export BUILDSHIP_REPO=/absolute/path/to/buildship
node dist/index.js
```

## Wire it into Claude Code

Add this server to `.mcp.json` (project-scoped) or `~/.claude.json` (user-scoped):

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship/mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/buildship"
      }
    }
  }
}
```

Then `/mcp` inside Claude Code should list `buildship` with the tools below.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_nodes` | List custom node ids, versions, and labels. Optional `search` substring. |
| `get_node` | Read `schema.json`, `inputs.json`, `output.json`, and `main.ts` for a node version. |
| `create_node` | Scaffold a new node directory (`nodes/<id>/<version>/`) with all five files and a label entry. |
| `update_node_file` | Replace a single file (`main.ts`, `inputs.json`, `output.json`, or `schema.json`) on an existing node version; JSON files are parsed before write. |
| `list_workflows` | List workflow folders with id, name, and description. |
| `get_workflow` | Read all six workflow JSON files for a given folder. |
| `create_workflow` | Scaffold a new workflow with `meta.json`, `schema.json`, `nodes.json`, `inputs.json`, `output.json`, `triggers.json`, plus a `flow-id-to-label/<workflowId>.txt`. Optionally seeds a REST trigger and any number of node entries; always appends a Flow Output node. |
| `add_node_to_workflow` | Append a node entry to an existing workflow's `nodes.json` and (optionally) sync `meta.nodeIdToLabel` and `schema.nodeValues`. |
| `set_flow_label` / `get_flow_label` | Read or write a single `flow-id-to-label/<id>.txt` file. |

### Example: create a node

```jsonc
{
  "name": "create_node",
  "arguments": {
    "id": "greet-user",
    "label": "Greet User",
    "description": "Returns a personalized greeting.",
    "inputs": {
      "name":     { "type": "string", "title": "Name",     "description": "Person's name." },
      "loud":     { "type": "boolean", "title": "Shout?",  "default": false }
    },
    "required": ["name"],
    "output": { "type": "string", "title": "Greeting" },
    "mainTs": "export default async function ({ name, loud }: NodeInputs): NodeOutput {\n  const out = `Hello, ${name}`;\n  return loud ? out.toUpperCase() + '!' : out;\n}\n"
  }
}
```

### Example: create a workflow with a REST trigger

```jsonc
{
  "name": "create_workflow",
  "arguments": {
    "name": "users/greet",
    "description": "Greets a user by name.",
    "trigger": { "method": "POST", "path": "/users/greet" },
    "nodes": [
      {
        "type": "script",
        "label": "Greet User",
        "nodeId": "greet-user",
        "version": "1.0.0",
        "values": { "name": { "_$keys_": ["inputs", "name"] } }
      }
    ]
  }
}
```

The server picks a folder name like `users-greet-aB3x`, generates a 20-char workflow id, writes all six workflow files, registers `flow-id-to-label/<workflowId>.txt`, and appends a Flow Output node for you.

## Safety guardrails

- Refuses to overwrite an existing node version or workflow folder unless you pass `overwrite: true`.
- Validates JSON content before writing JSON files via `update_node_file`.
- Enforces lowercase-kebab-case node ids and SemVer versions.
- Refuses to start if the repo root cannot be located, so the agent gets a clear error rather than scribbling files in `cwd`.

## Development

```bash
npm run dev        # tsc --watch
npm run typecheck  # tsc --noEmit
```

The server is plain stdio JSON-RPC, so you can smoke-test it from a shell:

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 0.3
) | node dist/index.js
```
