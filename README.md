# BuildShip MCP Server

[![MCP stdio](https://img.shields.io/badge/MCP-stdio-blue)](https://modelcontextprotocol.io)
[![Latest release](https://img.shields.io/github/v/release/sgardoll/buildship-mcp-server)](https://github.com/sgardoll/buildship-mcp-server/releases)
[![Node](https://img.shields.io/badge/Node.js-24_LTS_recommended-brightgreen)](https://nodejs.org/en/about/previous-releases)
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

## Quick Start

Use [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases) and Git. The minimum supported Node version is declared in [package.json](package.json).

### 1. Clone & build

```bash
git clone https://github.com/sgardoll/buildship-mcp-server.git
cd buildship-mcp-server
npm ci                   # `prepare` hook auto-builds dist/
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
claude mcp add --env BUILDSHIP_REPO=/absolute/path/to/your/buildship-repo \
  --transport stdio buildship -- node /absolute/path/to/buildship-mcp-server/dist/index.js
```

Then verify: `claude mcp list` should show `buildship`. Ask your assistant *"List all custom nodes in the BuildShip repo"* — if you get a list, you're done.

For other tools (Claude Desktop, Cursor, Zed, VS Code, Continue, OpenCode, Cline, Windsurf), see [Per-Tool Installation](#per-tool-installation) below.

---

## Updating an existing install

The server runs from your cloned checkout. Check its installed version and published release availability without starting an MCP session:

```bash
node dist/index.js --version
node dist/index.js --check-updates
```

The installed version comes from `package.json` and is also advertised in the MCP handshake. The badge above follows published GitHub Releases. Preparing version `0.3.0` does not publish it: until the first release is published, the checker reports `no_release` and the badge may be unavailable.

In your MCP client, call `check_for_updates` with `{ "force": false }` (or omit the arguments). Its JSON result includes `installedVersion`, `latestVersion`, `updateAvailable`, `releaseUrl`, and `updateInstructions`. The `status` is one of:

| Status | Meaning |
| --- | --- |
| `update_available` | A newer stable GitHub release is available. |
| `up_to_date` | The installed version is at least as new as the latest stable release. |
| `no_release` | No published stable release is available. |
| `unavailable` | The release check failed; this does not establish whether an update exists. |

Checks contact GitHub only when requested, with a 3-second timeout. Successful results, including `no_release`, are cached for 24 hours within the server process; failures are cached for 60 seconds. Set `force: true` to refresh. Each CLI invocation starts a fresh process and cache. Startup makes no update request, and the checker never installs updates. Version and update checks work without `BUILDSHIP_REPO`; inspect the JSON `status` because `unavailable` also exits successfully.

For release notifications, select **Watch → Custom → Releases** on the [GitHub repository](https://github.com/sgardoll/buildship-mcp-server), then save your notification preference. See [GitHub's notification settings](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications).

To update a checkout that follows a branch, first review `git status` and preserve any local edits, then:

```bash
cd /absolute/path/to/buildship-mcp-server
git pull --ff-only
npm ci
BUILDSHIP_REPO=/absolute/path/to/your/buildship-repo npm run check
```

To pin a published stable release, replace `vX.Y.Z` with the tag shown on the release page:

```bash
git fetch origin --tags
git switch --detach vX.Y.Z
npm ci
```

A release checkout uses detached HEAD, so `git pull` does not update it. Select the next release tag explicitly with the same commands. Do not overwrite local edits to switch versions.

`npm ci` rebuilds `dist/` through the `prepare` hook. Verify with `npm run check`, then fully quit and restart your MCP client so it starts the updated server process.

---

## One-Click Install

After you've cloned + built the server (Quick Start steps 1–3 above), click your client's button. It opens an install dialog pre-filled with the BuildShip MCP config — you just edit the two placeholder paths.

[![Install in Cursor](https://img.shields.io/badge/Install%20in-Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=buildship&config=eyJjb21tYW5kIjoibm9kZSIsImFyZ3MiOlsiL0FCU09MVVRFL1BBVEgvVE8vYnVpbGRzaGlwLW1jcC1zZXJ2ZXIvZGlzdC9pbmRleC5qcyJdLCJlbnYiOnsiQlVJTERTSElQX1JFUE8iOiIvQUJTT0xVVEUvUEFUSC9UTy95b3VyLWJ1aWxkc2hpcC1yZXBvIn19)
[![Install in VS Code](https://img.shields.io/badge/Install%20in-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/Install%20in-VS%20Code%20Insiders-1F9CF0?style=for-the-badge&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22buildship%22%2C%22command%22%3A%22node%22%2C%22args%22%3A%5B%22%2FABSOLUTE%2FPATH%2FTO%2Fbuildship-mcp-server%2Fdist%2Findex.js%22%5D%2C%22env%22%3A%7B%22BUILDSHIP_REPO%22%3A%22%2FABSOLUTE%2FPATH%2FTO%2Fyour-buildship-repo%22%7D%7D)

If a button does nothing, use the manual snippet in the per-tool section below.

### Other clients — jump to manual setup

These sections provide CLI or configuration-file setup:

[![Claude Code](https://img.shields.io/badge/Claude%20Code-Manual%20setup-D97757?style=for-the-badge)](#claude-code-cli)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Manual%20setup-D97757?style=for-the-badge)](#claude-desktop)
[![Zed](https://img.shields.io/badge/Zed-Manual%20setup-084CCF?style=for-the-badge)](#zed)
[![Continue](https://img.shields.io/badge/Continue-Manual%20setup-7B7BFF?style=for-the-badge)](#continuedev)
[![OpenCode](https://img.shields.io/badge/OpenCode-Manual%20setup-1F1F1F?style=for-the-badge)](#opencode)
[![Cline](https://img.shields.io/badge/Cline-Manual%20setup-FF6B6B?style=for-the-badge)](#cline)
[![Windsurf](https://img.shields.io/badge/Windsurf-Manual%20setup-0FCFA6?style=for-the-badge)](#windsurf)

---

## Per-Tool Installation

Every snippet below assumes you've replaced the two placeholders:

- `/ABSOLUTE/PATH/TO/buildship-mcp-server` — where you cloned this repo
- `/ABSOLUTE/PATH/TO/your-buildship-repo` — your BuildShip GitHub repo

### Claude Code (CLI)

Run this in your terminal. Keep all client options before the server name, as described in the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp):

```bash
claude mcp add --env BUILDSHIP_REPO=/ABSOLUTE/PATH/TO/your-buildship-repo \
  --transport stdio buildship -- node /ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js
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

Run **zed: open settings file** from Zed's command palette and merge this configuration. See [Zed's MCP documentation](https://zed.dev/docs/ai/mcp).

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

Add this entry to `mcpServers` in `~/.continue/config.yaml`. Continue's [MCP documentation](https://docs.continue.dev/customize/deep-dives/mcp) also describes workspace-local YAML configurations.

```yaml
mcpServers:
  - name: buildship
    command: node
    args:
      - /ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js
    env:
      BUILDSHIP_REPO: /ABSOLUTE/PATH/TO/your-buildship-repo
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

### Cline

Open **MCP Servers → Configure → Configure MCP Servers** in Cline. Current releases use `~/.cline/data/settings/cline_mcp_settings.json` by default; opening it through the UI also handles configured path overrides. See the [settings path resolver](https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts) and [Cline MCP configuration](https://docs.cline.bot/mcp/mcp-overview).

```json
{
  "mcpServers": {
    "buildship": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/buildship-mcp-server/dist/index.js"],
      "env": {
        "BUILDSHIP_REPO": "/ABSOLUTE/PATH/TO/your-buildship-repo"
      },
      "autoApprove": [],
      "disabled": false
    }
  }
}
```

Save and verify BuildShip appears in Cline's MCP server list.

---

### Roo Code

Use **Edit Project MCP** in Roo's MCP settings, or create `.roo/mcp.json` in your project. Roo uses `alwaysAllow`, while Cline uses `autoApprove`. See [Roo's MCP configuration](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/).

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

---

### Windsurf

For the legacy Cascade agent, edit `~/.codeium/windsurf/mcp_config.json` through the MCP settings panel. These instructions are specific to Cascade; the Devin Local agent has separate configuration. See the [current Cascade MCP documentation](https://docs.devin.ai/desktop/cascade/mcp).

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
| `BUILDSHIP_REPO` | No; recommended | Absolute path to your BuildShip directory. If omitted, the server walks upward from its own location, then from its working directory (`cwd`), looking for `nodes/` and `workflows/`. Explicit configuration avoids depending on the client's launch directory. |

---

## Troubleshooting

**`Could not locate the BuildShip repo`** — `BUILDSHIP_REPO` is unset and auto-detection failed. Set the env var to the absolute path of your repo. Verify with `BUILDSHIP_REPO=/your/path npm run check`.

**`... does not look like a BuildShip repo (missing nodes/ or workflows/)`** — point at the directory containing both `nodes/` and `workflows/`. This directory can itself be inside a larger Git repository. If the directories are missing entirely, check your BuildShip project's GitHub Integration settings.

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
- `main.ts` — the executable TypeScript entrypoint, with a callable default export

> Keep a callable default export: synchronous functions, async functions, arrow functions, and named functions exported as default are supported. Preserve published input/output property keys that existing workflows reference. Node IDs must be lowercase kebab-case.

### Workflow conventions

Each workflow lives under `workflows/<folder>/` with six files:

- `schema.json` — id, name, description, runtime version, node values, variables
- `meta.json` — git integration version, node ID-to-label mapping
- `nodes.json` — ordered array of complete deployable node definitions (source, schemas, dependencies, metadata)
- `inputs.json` — workflow-level input parameters
- `output.json` — workflow-level output schema
- `triggers.json` — how the workflow is initiated (REST endpoint, cron, etc.)

Plus `flow-id-to-label/<workflowId>.txt` mapping the workflow ID to a human-readable label. `create_workflow` generates a 20-character workflow ID; the UUIDs used for individual workflow nodes are separate.

> Node `id` fields inside `nodes.json` are referenced for execution wiring — never change them. When upgrading a node version in a workflow, verify that inputs/outputs are compatible.

---

## Tools Reference

| Tool | Purpose |
| --- | --- |
| `list_nodes` | List custom node ids, versions, and labels. Optional `search` substring. |
| `get_node` | Read `schema.json`, `inputs.json`, `output.json`, and `main.ts` for a node version. |
| `create_node` | Create and type-check a node transactionally; every file is rolled back if deployment validation fails. |
| `update_node_file` | Replace one node file, then type-check and validate the complete node; restore the prior file on failure. |
| `list_workflows` | List workflow folders with id, name, and description. |
| `get_workflow` | Read all six workflow JSON files for a given folder. |
| `create_workflow` | Create a transactionally validated workflow with a complete REST v2 trigger, fully materialized nodes, one Flow Output node, and its label mapping. |
| `add_node_to_workflow` | Materialize a complete custom/control node and atomically update `nodes.json`, `meta.json`, and `schema.json`. |
| `set_flow_label` / `get_flow_label` | Read or write a single `flow-id-to-label/<id>.txt` file. |
| `validate_deployment` | Run local deployment preflight for one node, one workflow, or the whole repo: required files, supported schemas, TypeScript, references, bindings, and serialization checks. |
| `sync_to_git` | Validate changed artifacts, stage only inspected BuildShip-managed paths, commit, and optionally push. A clean checkout can retry a previous push. |
| `check_for_updates` | Check the latest published stable GitHub release and return version information and manual update instructions. Optional `force` bypasses the process cache. |

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
    "mainTs": "export default async function ({ name, loud }: NodeInputs): Promise<NodeOutput> {\n  const out = `Hello, ${name}`;\n  return loud ? out.toUpperCase() + '!' : out;\n}\n"
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
    "inputs": { "name": { "type": "string" } },
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

The server picks a folder name like `users-greet-aB3x`, generates a 20-char workflow id, embeds the `greet-user` definition, writes the REST trigger, appends one Flow Output node, and runs local preflight before completing the file transaction. The input declaration above is required for the `inputs.name` binding. Configure and test the actual request mapping in BuildShip before relying on the endpoint.

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

The server validates changed nodes/workflows, stages only inspected paths under `nodes/`, `workflows/`, and `flow-id-to-label/`, commits with your message, and pushes to the configured Git remote. Set `push: false` to commit only. If push fails, the result retains the locally created `commitHash` and reports `pushError`. Call `sync_to_git` again with `push: true` to retry; when the checkout is clean, it pushes the existing commit without creating another. As with ordinary `git push`, this can publish other commits already present on the branch.

### Validation and deployment boundaries

`validate_deployment` is a local preflight, not a BuildShip deployment receipt. It checks this server's supported serialization rules and TypeScript contracts; it does not install or execute node dependencies, verify credentials, register triggers, or call an endpoint. Unresolved-import diagnostics are intentionally excluded, and schema checking covers a subset of JSON Schema.

A successful Git push confirms Git transport completed. BuildShip acceptance and a real trigger execution must be verified separately in the configured project. BuildShip documents [deployment through GitHub commits](https://buildship.com/changelog) and [REST trigger configuration and testing](https://docs.buildship.com/triggers-rest-api/rest-api).

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
> → Calls `sync_to_git` to validate and commit changed BuildShip-managed files, then push the branch to its configured Git remote.

---

## Safety Guardrails

- Refuses to overwrite an existing node version or workflow folder unless you pass `overwrite: true`.
- Strictly reads every required artifact; missing or malformed files are errors rather than `null`, `[]`, or `{}` fallbacks.
- Type-checks `main.ts` against generated `NodeInputs`/`NodeOutput` types and validates schema compatibility and workflow references.
- Rejects skeletal/library workflow nodes and emits complete BuildShip REST v2 trigger/node definitions.
- Rolls back related files as one transaction when a write or deployment validation fails.
- Enforces traversal-safe node ids, workflow folders, label ids, and SemVer versions.
- Checks repository containment at filesystem read/write boundaries and rejects symbolic links below the configured repository root, including file links. A symlink used to locate the repository root itself is supported.
- Serializes tool operations within one server process, including preparation, validation, and rollback, so concurrent edits do not overwrite one another and reads do not observe partial tool writes.
- All git operations use `execFileSync` with args array (no shell) — no shell injection risk.
- Rejects pre-existing staged changes and never stages unrelated repository files.
- Refuses to start if the repo root cannot be located, so the agent gets a clear error rather than scribbling files in `cwd`.

These protections coordinate one server process. Other processes can still change files or the Git index, and filesystem checks do not provide a sandbox against an adversarial process racing path changes. Use a dedicated checkout when running multiple agents or external Git tools. MCP behavior annotations describe tool effects for clients; they do not enforce permissions.

---

## Development

```bash
npm run dev        # tsc --watch
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/index.js
npm run check      # resolve BUILDSHIP_REPO and exit
npm run check:updates # check published releases and print JSON
npm test           # tsc + complete node:test suite
npm run lint       # biome check src test scripts
npm run format     # biome format --write src test scripts
```

Tests use Node's built-in `node:test` runner. GitHub Actions runs typecheck, lint, and tests for pushes to `main`/`master` and pull requests targeting those branches.

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

## Preparing a release

The package version is the source for the CLI and MCP handshake. Prepare the next version on a branch; for the first release:

```bash
npm version 0.3.0 --no-git-tag-version
npm run check:release -- 0.3.0
```

For later releases, substitute the next stable version. If `package.json` already contains the intended version, skip the version command. Commit the version and lockfile changes with the release notes, open a PR, and merge after review.

After the PR merges, manually run the [release workflow](.github/workflows/release.yml) from `main`, supplying the exact version in `package.json`. It runs the required checks and creates a **draft GitHub Release** tagged `vVERSION` at the checked commit SHA. Review the draft and publish it separately. Preparing a version or merging its PR does not publish a release, and this workflow does not publish an npm package.

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
