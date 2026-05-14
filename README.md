# BuildShip MCP Server

[![MCP stdio](https://img.shields.io/badge/MCP-stdio-blue?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0tMSAxNy45M2MtMy45NS0uNDktNy0zLjg1LTctNy45MyAwLS42Mi4wOC0xLjIxLjIxLTEuNzlMOSAxNXYxYy41NSAwIDEgLjQ1IDEgMXY0Ljkzek0xNyAxM2MtLjU1IDAtMS0uNDUtMS0xdi0xLjczbC0zLjEzLTMuMTNjLS4zNi0uMzYtLjg2LS41OC0xLjQxLS41OC0uNTUgMC0xLjA1LjIxLTEuNDEuNTlMNy4xNCAxMC41OWMtLjM2LjM2LS41OS44Ni0uNTkgMS40MSAwIC41NS4yMiAxLjA1LjU5IDEuNDFsMy4xMyAzLjEzaC0uMTVWMjBjLS41NSAwLTEgLjQ1LTEgMXYtNVYxM2MwLS41NS0uNDUtMS0xLTFWMiAxMy4xNGw1LjU5LTUuNTljLjM2LS4zNi44Ni0uNTkgMS40MS0uNTkuNTUgMCAxLjA1LjIxIDEuNDEuNTlMMTcuNzMgMTEgMTkgOS43M1YxM3oiLz48L3N2Zz4=)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node.js-%5E18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/github/license/YOUR_ORG/buildship-mcp-server)](LICENSE)

> **Model Context Protocol server** that lets your AI assistant create and edit BuildShip **custom nodes** and **workflows** directly in your repository.

> **GitHub Integration Required** — This MCP server works with BuildShip's GitHub-connected repository. Before using it, make sure **GitHub Integration is active** in your BuildShip project Settings. If you see a screen like the one below, click **"Talk to us"** to enable it on your plan.
> 
> ![BuildShip GitHub Integration settings screen showing "Version control, CI/CD pipeline and automated deployments" with a "Talk to us" button](docs/github-integration-required.png)

## What it does

This MCP server exposes BuildShip repo operations as AI-callable tools. Your AI agent can:

| Capability | Description |
|---|---|
| **List & read** custom nodes and workflows |
| **Create** new nodes (`nodes/<id>/<version>/` with schema, inputs, output, meta, main.ts) |
| **Create** new workflows (`workflows/<folder>/` with all 6 JSON files + trigger) |
| **Update** node source code and JSON descriptors |
| **Wire** nodes into existing workflows |

---

## One-Click Install Buttons

If your AI tool supports click-to-install badges, paste these into your own README or docs:

```markdown
[![Install in Claude Code](https://img.shields.io/badge/Claude%20Code-Install-blue?style=for-the-badge&logo=claude&logoColor=white)](https://docs.claude.com/docs/claude-code-mcp)
[![Install in Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Install-purple?style=for-the-badge&logo=claude&logoColor=white)](https://docs.anthropic.com/en/docs/claude-desktop/installation)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-black?style=for-the-badge&logo=cursor&logoColor=white)](https://www.cursor.com)
[![Install in Zed](https://img.shields.io/badge/Zed-Install-084CCF?style=for-the-badge&logo=zedindustries&logoColor=white)](https://zed.dev)
[![Install in Cline](https://img.shields.io/badge/Cline-Install-FF6B6B?style=for-the-badge)](https://cline.bot)
```

---

## Quick Start (< 2 minutes)

### 1. Clone & build

```bash
git clone https://github.com/YOUR_ORG/buildship-mcp-server.git
cd buildship-mcp-server
npm install
npm run build       # builds dist/index.js
```

### 2. Point to your BuildShip repo

The server auto-locates the repo by walking up from its own directory.
If it can't find it, set this environment variable:

```bash
export BUILDSHIP_REPO=/absolute/path/to/your/buildship-repo
```

### 3. Configure your AI tool

Pick your tool below and copy-paste the config.

---

## Per-Tool Installation

### Claude Code (CLI)

One command in your terminal (not inside Claude Code itself):

```bash
# macOS / Linux
claude mcp add --transport stdio buildship -- node \
  /absolute/path/to/buildship-mcp-server/dist/index.js

# Windows (add BUILDSHIP_REPO to your env first)
claude mcp add --transport stdio buildship -- node \
  C:\path\to\buildship-mcp-server\dist\index.js
```

Verify: run `claude mcp list` → you should see `buildship` listed.

> **Project-scoped (team shared):** Create `.mcp.json` in your project root:
> ```json
> {
>   "mcpServers": {
>     "buildship": {
>       "command": "node",
>       "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
>       "env": { "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo" }
>     }
>   }
> }
> ```
> This file can be committed for your team.

---

### Claude Desktop

Edit your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the `mcpServers` block (merge with existing if present):

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      }
    }
  }
}
```

**Quit Claude Desktop completely** (`Cmd+Q` on macOS, close window + quit on Windows) and reopen.

Verify: open chat → the tool picker should list BuildShip tools.

---

### Cursor

Create or edit one of:

- **Project-scoped:** `.cursor/mcp.json` (inside your project root)
- **Global:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      }
    }
  }
}
```

Restart Cursor. The tools will appear in **Composer → Agent** mode.

---

### Cline / Roo Code

Cline stores config in VS Code extension settings. Open the Cline panel → ⚙️ → **MCP Servers** → **Edit MCP Settings**, or edit the file directly:

- **macOS:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows:** `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

Save → Cline auto-reloads. Verify in the MCP Servers panel.

---

### Zed

Edit `~/.config/zed/settings.json` (or `~/Library/Application Support/Zed/settings.json` on macOS):

```json
{
  "assistant": {
    "mcp_servers": {
      "buildship": {
        "command": "node",
        "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
        "env": {
          "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
        }
      }
    }
  }
}
```

Reload `Cmd+Shift+P` → "zed: reload". Tools appear in the assistant slash menu.

---

### Windsurf

Windsurf uses standard `mcpServers` JSON. Add to Windsurf's MCP settings (or `.windsurf/mcp.json` if supported):

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      }
    }
  }
}
```

---

### Continue.dev

Edit `~/.continue/config.json`:

```json
{
  "mcp_server": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      }
    }
  }
}
```

---

### OpenCode

Edit `.opencode/mcp.json` (project-scoped) or `~/.opencode/mcp.json` (global):

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/absolute/path/to/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/absolute/path/to/your/buildship-repo"
      }
    }
  }
}
```

---

## Universal Install with `add-mcp`

If you have the `add-mcp` CLI installed, install into *all* supported tools at once:

```bash
# Install to all detected MCP clients
npx add-mcp https://github.com/YOUR_ORG/buildship-mcp-server --all

# Or target specific ones
npx add-mcp https://github.com/YOUR_ORG/buildship-mcp-server -a claude-code -a cursor
```

> `add-mcp` auto-generates the correct JSON format for each client. [Learn more](https://www.npmjs.com/package/add-mcp)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BUILDSHIP_REPO` | **Strongly recommended** | Absolute path to your BuildShip repo. If omitted, the server walks up from its own directory and `cwd` looking for `nodes/` + `workflows/` + `flow-id-to-label/`. |

---

## File Layout

The server expects your BuildShip repo to follow these conventions:

```
nodes/<id>/<version>/{schema,inputs,output,meta}.json  + main.ts
workflows/<folder>/{schema,meta,nodes,inputs,output,triggers}.json
flow-id-to-label/<workflowId>.txt
```

### Node conventions

Each version lives under `nodes/<id>/<version>/` with five files:
- `schema.json` — id, label, description, type, version, dependencies, icon metadata
- `inputs.json` — parameter definitions visible in the BuildShip UI
- `output.json` — return value schema consumed by downstream nodes
- `meta.json` — metadata (e.g. `gitIntegrationVersion`)
- `main.ts` — the executable TypeScript entrypoint (default export async function)

> Do not rename or remove input/output property keys once published — existing workflows reference them by name. Keep the `export default async function` signature. Node IDs must be lowercase kebab-case.

### Workflow conventions

Each workflow lives under `workflows/<folder>/` with six files:
- `schema.json` — id, name, description, runtime version, node values, variables
- `meta.json` — git integration version, node ID-to-label mapping
- `nodes.json` — ordered array of node entries (each with id, type, label, and optional library ref/version)
- `inputs.json` — workflow-level input parameters
- `output.json` — workflow-level output schema
- `triggers.json` — how the workflow is initiated (REST endpoint, cron, etc.)

Plus `flow-id-to-label/<workflowId>.txt` mapping the workflow's UUID to a human-readable label.

> Node `id` fields inside `nodes.json` are referenced for execution wiring — never change them. When upgrading a node version in a workflow, verify that inputs/outputs are compatible.

---

## Tools Reference

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
      "name":     { "type": "string",  "title": "Name",     "description": "Person's name." },
      "loud":     { "type": "boolean", "title": "Loud",     "description": "YELL if true." }
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

---

## Smoketest: Ask Claude to do this

Once configured, ask your AI assistant:

> **"List all custom nodes in the BuildShip repo."**
> → Claude calls `list_nodes` and shows you every node with its id, version, and label.

> **"Create a new node called `reverse-string` that takes a `text` input and returns it reversed."**
> → Claude calls `create_node`, generating schema, inputs, output, meta, and main.ts. You commit the new folder.

> **"Create a workflow `api/reverse` with a POST trigger at `/reverse` that wires the `reverse-string` node."**
> → Claude calls `create_workflow` with the trigger and node wiring, then calls `set_flow_label`.

---

## Safety Guardrails

- Refuses to overwrite an existing node version or workflow folder unless you pass `overwrite: true`.
- Validates JSON content before writing JSON files via `update_node_file`.
- Enforces lowercase-kebab-case node ids and SemVer versions.
- Refuses to start if the repo root cannot be located, so the agent gets a clear error rather than scribbling files in `cwd`.

---

## Development

```bash
npm run dev        # tsc --watch
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/index.js
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

---

## Git Remote Setup

This repo was originally hosted under a personal account. Before pushing any changes, point it to your own remote:

```bash
# Check current remote
git remote -v

# Replace with your own repository
git remote set-url origin https://github.com/YOUR_ORG/YOUR_REPO.git

# Or run the interactive helper
npm run init-remote
```

Or skip interactive prompts:

```bash
BUILDSHIP_GIT_REMOTE=https://github.com/my-org/buildship-components.git npm run init-remote
```
