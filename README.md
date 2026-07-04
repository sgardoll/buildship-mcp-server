# BuildShip MCP Server

[![MCP stdio](https://img.shields.io/badge/MCP-stdio-blue)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Model Context Protocol server** that lets your AI assistant create and edit BuildShip **custom nodes** and **workflows** directly in your repository.

<img width="2360" height="1340" alt="Gemini_Generated_Image_34mrfq34mrfq34mr" src="https://github.com/user-attachments/assets/f1d03952-41bc-4398-be80-f1db93d779a9" />

## What it does

This MCP server exposes BuildShip repo operations as AI-callable tools. Your AI agent can:

| Capability | Description |
| --- | --- |
| **List & read** | Custom nodes and workflows |
| **Create** | New nodes (`nodes/<id>/<version>/` with schema, inputs, output, meta, main.ts) |
| **Create** | New workflows (`workflows/<folder>/` with all 6 JSON files + trigger) |
| **Update** | Node source code and JSON descriptors |
| **Wire** | Nodes into existing workflows |
| **Sync** | Stage, commit, and push changes to GitHub via BuildShip's GitHub Integration |

---

## ⚠️ Prerequisite — Enable BuildShip GitHub Integration

This server reads and writes the **GitHub repository** that BuildShip syncs your project to. Before it can do anything useful, your BuildShip project must have **GitHub Integration enabled** in Project Settings.

If GitHub Integration isn't on your plan, BuildShip's settings page shows a **"Talk to us"** button under *Version control, CI/CD pipeline and automated deployments* — click it to enable it.

Once enabled, BuildShip will sync `nodes/`, `workflows/`, and `flow-id-to-label/` directories into your GitHub repo. That repo is what you'll point `BUILDSHIP_REPO` at below.

---

## Quick Start (genuine 2 minutes)

This is the full happy path. Skip nothing.

### 1. Clone & build

```bash
git clone https://github.com/sgardoll/buildship-mcp-server.git
cd buildship-mcp-server
npm install              # `prepare` hook auto-builds dist/
```

> If you already cloned previously and `dist/` is missing, run `npm run build`.

### 2. Find the absolute path to your BuildShip repo

This is the GitHub repo BuildShip syncs to (see prerequisite above). It must contain `nodes/` and `workflows/` directories at its root.

```bash
# macOS / Linux — print the full path
cd /path/to/your/buildship-repo && pwd

# Windows (PowerShell)
cd C:\path\to\your\buildship-repo; (Get-Location).Path
```

Copy that path — you'll paste it as `BUILDSHIP_REPO` in step 3.

### 3. Sanity-check the install

From inside `buildship-mcp-server`:

```bash
BUILDSHIP_REPO=/absolute/path/to/your/buildship-repo npm run check
# → BuildShip repo: /absolute/path/to/your/buildship-repo
```

If you see that line, the server is correctly built and locates your repo. If you see an error, jump to [Troubleshooting](#troubleshooting).

### 4. Wire it into your AI tool

Pick **one** tool below and paste the snippet. The Claude Code CLI is the fastest:

```bash
claude mcp add --transport stdio \
  --env BUILDSHIP_REPO=/absolute/path/to/your/buildship-repo \
  buildship -- node /absolute/path/to/buildship-mcp-server/dist/index.js
```

Then verify: `claude mcp list` should show `buildship`. Ask your assistant *"List all custom nodes in the BuildShip repo"* — if you get a list, you're done.

For other tools (Claude Desktop, Cursor, Zed, VS Code, Continue, OpenCode, Cline, Windsurf), see [Per-Tool Installation](#per-tool-installation) below.

---

## One-Click Install

After you've cloned + built the server (Quick Start steps 1–3 above), click your client's button. It opens an install dialog pre-filled with the BuildShip MCP config — you just edit the two placeholder paths.

[![Install in Cursor](https://img.shields.io/badge/Install%20in-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=buildship&config=eyJjb21tYW5kIjoibm9kZSIsImFyZ3MiOlsiL0FCU09MVVRFL1BBVEgvVE8vYnVpbGRzaGlwLW1jcC1zZXJ2ZXIvZGlzdC9pbmRleC5qcyJdLCJlbnYiOnsiQlVJTERTSElQX1JFUE8iOiIvQUJTT0xVVEUvUEFUSC9UTy95b3VyLWJ1aWxkc2hpcC1yZXBvIn19)
[![Install in VS Code](https://img.shields.io/badge/Install%20in-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/Install%20in-VS%20Code%20Insiders-1F9CF0?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)

> These three are the **only** MCP clients (as of 2026) that publish a config-bearing deep-link protocol. If the button does nothing, your OS doesn't have a handler registered for the URL scheme — use the manual snippet in the per-tool section below.

### Other clients — jump to manual setup

No deep-link protocol exists for these yet, so installation is a one-time JSON snippet paste. Each section below has the exact text to copy:

[![Claude Code](https://img.shields.io/badge/Claude%20Code-Manual%20setup-D97757?style=for-the-badge)](#claude-code-cli)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Manual%20setup-D97757?style=for-the-badge)](#claude-desktop)
[![Zed](https://img.shields.io/badge/Zed-Manual%20setup-084CCF?style=for-the-badge)](#zed)
[![Continue](https://img.shields.io/badge/Continue-Manual%20setup-7B7BFF?style=for-the-badge)](#continuedev)
[![OpenCode](https://img.shields.io/badge/OpenCode-Manual%20setup-1F1F1F?style=for-the-badge)](#opencode)
[![Cline](https://img.shields.io/badge/Cline-Manual%20setup-FF6B6B?style=for-the-badge)](#cline--roo-code)
[![Windsurf](https://img.shields.io/badge/Windsurf-Manual%20setup-0FCFA6?style=for-the-badge)](#windsurf)

> *Claude Code is "manual" only in the sense that there's no URL-scheme one-click — but its `claude mcp add` CLI is effectively one command.*

---

## Per-Tool Installation

Every snippet below assumes you've replaced the two placeholders:

- `/ABSOLUTE/PATH/TO/buildship-mcp-server` — where you cloned this repo
- `/ABSOLUTE/PATH/TO/your-buildship-repo` — your BuildShip GitHub repo

### Claude Code (CLI)

One command in your terminal (not inside Claude Code itself):

```bash
claude mcp add --transport stdio \
  --env BUILDSHIP_REPO=/ABSOLUTE/PATH/TO/your-buildship-repo \
  buildship -- node /ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js
```

Verify: `claude mcp list` → you should see `buildship`. To remove later: `claude mcp remove buildship`.

> **Project-scoped (team shared):** Create `.mcp.json` in your project root and commit it for your team:
> ```json
> {
>   "mcpServers": {
>     "buildship": {
>       "type": "stdio",
>       "command": "node",
>       "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
>       "env": { "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo" }
>     }
>   }
> }
> ```

---

### Claude Desktop

Edit the config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add (or merge into) `mcpServers`:

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      }
    }
  }
}
```

**Fully quit Claude Desktop** (`Cmd+Q` on macOS — closing the window isn't enough) and reopen. The tool picker should now list BuildShip tools.

---

### Cursor

Cursor supports an MCP deep-link install. Click this badge **after you've cloned and built the server**, then edit the placeholder paths in the dialog Cursor opens:

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=buildship&config=eyJjb21tYW5kIjoibm9kZSIsImFyZ3MiOlsiL0FCU09MVVRFL1BBVEgvVE8vYnVpbGRzaGlwLW1jcC1zZXJ2ZXIvZGlzdC9pbmRleC5qcyJdLCJlbnYiOnsiQlVJTERTSElQX1JFUE8iOiIvQUJTT0xVVEUvUEFUSC9UTy95b3VyLWJ1aWxkc2hpcC1yZXBvIn19)

**Or manually** — create or edit one of:

- **Project-scoped:** `.cursor/mcp.json` (in your project root)
- **Global:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      }
    }
  }
}
```

Restart Cursor. Tools appear in **Composer → Agent** mode.

---

### VS Code

VS Code 1.99+ ships native MCP support. Click this badge to open the install dialog (you'll still edit the paths):

[![Add to VS Code](https://img.shields.io/badge/Add%20to-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)
[![Add to VS Code Insiders](https://img.shields.io/badge/Add%20to-VS%20Code%20Insiders-1F9CF0?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)

**Or via CLI:**

```bash
code --add-mcp '{"name":"buildship","command":"node","args":["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],"env":{"BUILDSHIP_REPO":"/ABSOLUTE/PATH/TO/your-buildship-repo"}}'
```

---

### Zed

Edit `~/.config/zed/settings.json` (or `~/Library/Application Support/Zed/settings.json` on macOS):

```json
{
  "context_servers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      }
    }
  }
}
```

Reload Zed (`Cmd+Shift+P` → "zed: reload"). Tools appear in the agent's tool list.

---

### Continue.dev

Continue uses `~/.continue/config.yaml` (YAML is the current schema). Add:

```yaml
mcpServers:
  - name: buildship
    command: node
    args:
      - /ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js
    env:
      BUILDSHIP_REPO: /ABSOLUTE/PATH/TO/your-buildship-repo
```

Or, if you still use the legacy JSON config:

```json
{
  "mcpServers": [
    {
      "name": "buildship",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": { "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo" }
    }
  ]
}
```

---

### OpenCode

OpenCode reads `opencode.json` (project root) or `~/.config/opencode/opencode.json` (global). Add a `mcp` block:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "buildship": {
      "type": "local",
      "command": ["node", "/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "enabled": true,
      "environment": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      }
    }
  }
}
```

Or interactively: `opencode mcp add`.

---

### Cline / Roo Code

Open the Cline panel → ⚙️ → **MCP Servers** → **Edit MCP Settings**, or edit the file directly:

- **macOS:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows:** `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

Save — Cline auto-reloads.

---

### Windsurf

Add to Windsurf's MCP settings (Settings → MCP Servers) or to `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `BUILDSHIP_REPO` | **Yes (recommended)** | Absolute path to your BuildShip GitHub repo. If omitted, the server walks up from its own directory and `cwd` looking for `nodes/` + `workflows/`. Auto-detection only works when the server is *inside* the BuildShip repo, so explicit is safer. |

---

## Troubleshooting

**`Could not locate the BuildShip repo`** — `BUILDSHIP_REPO` is unset and auto-detection failed. Set the env var to the absolute path of your repo. Verify with `BUILDSHIP_REPO=/your/path npm run check`.

**`... does not look like a BuildShip repo (missing nodes/ or workflows/)`** — the path you set exists, but doesn't contain `nodes/` and `workflows/` directories. Make sure you're pointing at the **root** of the GitHub repo BuildShip syncs to, not a subfolder. If the directories are missing entirely, your BuildShip project may not have GitHub Integration enabled yet — see the [prerequisite](#%EF%B8%8F-prerequisite--enable-buildship-github-integration) above.

**`Cannot find module '.../dist/index.js'`** — `dist/` doesn't exist yet. Run `npm run build` inside the cloned repo. (Fresh installs auto-build via the `prepare` hook; this only happens after a manual `git clone` followed by `npm install --ignore-scripts` or a broken build.)

**Tools don't appear in my client** — most clients need a full restart, not just a reload. For Claude Desktop, that means `Cmd+Q` and reopen. Check the client's MCP logs for `[buildship-mcp] ready`.

**The deep-link button does nothing** — your OS may not have a handler registered for the `cursor://` or `vscode:` URL scheme. Use the manual config snippet in that tool's section instead.

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
| `sync_to_git` | Stage, commit, and optionally push changes in the BuildShip repo's git working tree. Use after creating or updating nodes/workflows to sync to GitHub. |

### Example: create a node

```jsonc
{
  "name": "create_node",
  "arguments": {
    "id": "greet-user",
    "label": "Greet User",
    "description": "Returns a personalized greeting.",
    "inputs": {
      "name": { "type": "string",  "title": "Name", "description": "Person's name." },
      "loud": { "type": "boolean", "title": "Loud", "description": "YELL if true." }
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

### Example: sync changes to GitHub

```jsonc
{
  "name": "sync_to_git",
  "arguments": {
    "message": "Add reverse-string node and wire into api/reverse workflow",
    "push": true
  }
}
```

The server stages all changes in the BuildShip repo, commits with your message, and pushes to GitHub. Set `push: false` to commit only (e.g., to batch changes before pushing). Push failures are soft — the commit succeeds even if the remote is unreachable.

---

## Smoketest: Ask your AI to do this

Once configured, ask your AI assistant:

> **"List all custom nodes in the BuildShip repo."**
> → Calls `list_nodes` and shows you every node with its id, version, and label.

> **"Create a new node called `reverse-string` that takes a `text` input and returns it reversed."**
> → Calls `create_node`, generating schema, inputs, output, meta, and main.ts.

> **"Create a workflow `api/reverse` with a POST trigger at `/reverse` that wires the `reverse-string` node."**
> → Calls `create_workflow` with the trigger and node wiring, then calls `set_flow_label`.

> **"Sync all changes to GitHub."**
> → Calls `sync_to_git` to stage, commit, and push everything to the BuildShip repo's git remote.

---

## Safety Guardrails

- Refuses to overwrite an existing node version or workflow folder unless you pass `overwrite: true`.
- Validates JSON content before writing JSON files via `update_node_file`.
- Enforces lowercase-kebab-case node ids and SemVer versions.
- All path operations use `safeJoin` — path traversal via `..` or absolute paths is blocked.
- All git operations use `execFileSync` with args array (no shell) — no shell injection risk.
- Push failures are soft — the commit succeeds even if the remote is unreachable or authentication fails.
- Refuses to start if the repo root cannot be located, so the agent gets a clear error rather than scribbling files in `cwd`.

---

## Development

```bash
npm run dev        # tsc --watch
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/index.js
npm run check      # resolve BUILDSHIP_REPO and exit
```

The server is plain stdio JSON-RPC, so you can smoke-test it from a shell:

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  sleep 0.3
) | BUILDSHIP_REPO=/your/repo node dist/index.js
```

---

## Forking / Setting Your Own Remote

If you forked this repo to host your own copy:

```bash
git remote set-url origin https://github.com/YOUR_FORK/buildship-mcp-server.git
# Or run the interactive helper
npm run init-remote
```

Or skip the prompt:

```bash
BUILDSHIP_GIT_REMOTE=https://github.com/your-fork/buildship-mcp-server.git npm run init-remote
```

---

## License

MIT — see [LICENSE](LICENSE).
