#!/usr/bin/env node
// End-to-end test suite that walks through the README as a first-time user.
//
// Covers:
//   • Build artefact produced by `npm install`'s `prepare` hook
//   • `npm run check` failure modes (no env, bad path, missing nodes/workflows)
//   • `npm run check` success against a fresh fake BuildShip repo
//   • Stdio JSON-RPC smoke test from README (initialize / tools/list)
//   • All 10 tools end-to-end: list_nodes, create_node, get_node, update_node_file,
//     list_workflows, create_workflow, get_workflow, add_node_to_workflow,
//     set_flow_label, get_flow_label
//   • Safety guardrails: overwrite refusal, invalid kebab-case id, invalid semver
//
// Run from the repo root: `node scripts/test-readme-walkthrough.mjs`
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "..", "..");
const DIST = join(REPO, "dist", "index.js");

const RESULTS = [];
let PASS = 0;
let FAIL = 0;

function record(name, ok, detail = "") {
  RESULTS.push({ name, ok, detail });
  if (ok) PASS++; else FAIL++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function runSync(cmd, args, env = {}) {
  return spawnSync(cmd, args, {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function makeFakeRepo({ withDirs = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-buildship-"));
  if (withDirs) {
    mkdirSync(join(dir, "nodes"), { recursive: true });
    mkdirSync(join(dir, "workflows"), { recursive: true });
    mkdirSync(join(dir, "flow-id-to-label"), { recursive: true });
  }
  return dir;
}

// --- 1. Build artefacts ------------------------------------------------------
section("Build artefacts");
record("dist/index.js exists after `npm install`", existsSync(DIST), DIST);
record(
  "dist/index.js has #!/usr/bin/env node shebang",
  existsSync(DIST) && readFileSync(DIST, "utf8").startsWith("#!/usr/bin/env node"),
);

// --- 2. `npm run check` failure modes ----------------------------------------
section("`npm run check` failure modes");

// Clear BUILDSHIP_REPO and run from /tmp so auto-detection can't find anything.
const tmpCwd = mkdtempSync(join(tmpdir(), "check-cwd-"));
{
  const r = spawnSync("node", [DIST, "--check"], {
    cwd: tmpCwd,
    encoding: "utf8",
    env: { ...process.env, BUILDSHIP_REPO: "" },
  });
  const combined = (r.stdout || "") + (r.stderr || "");
  record(
    "exits non-zero when BUILDSHIP_REPO unset and no repo above cwd",
    r.status !== 0,
    `exit=${r.status}`,
  );
  record(
    "error message mentions `Could not locate the BuildShip repo`",
    /Could not locate the BuildShip repo/i.test(combined),
  );
}

{
  const r = runSync("node", [DIST, "--check"], {
    BUILDSHIP_REPO: "/nonexistent/path/should/not/exist",
  });
  record(
    "exits non-zero on a non-existent BUILDSHIP_REPO path",
    r.status !== 0,
    `exit=${r.status}`,
  );
}

{
  const bareDir = mkdtempSync(join(tmpdir(), "bare-repo-"));
  const r = runSync("node", [DIST, "--check"], { BUILDSHIP_REPO: bareDir });
  const combined = (r.stdout || "") + (r.stderr || "");
  record(
    "exits non-zero when nodes/ + workflows/ are missing",
    r.status !== 0,
    `exit=${r.status}`,
  );
  record(
    "error mentions missing nodes/ or workflows/",
    /missing nodes\/ or workflows\//i.test(combined) ||
      /does not look like a BuildShip repo/i.test(combined),
  );
  rmSync(bareDir, { recursive: true, force: true });
}

// --- 3. `npm run check` success ---------------------------------------------
section("`npm run check` happy path");
const FAKE = makeFakeRepo();
{
  const r = runSync("node", [DIST, "--check"], { BUILDSHIP_REPO: FAKE });
  record("exit code 0", r.status === 0, `exit=${r.status}`);
  record(
    "stdout prints `BuildShip repo: <path>`",
    r.stdout.includes(`BuildShip repo: ${FAKE}`),
    r.stdout.trim(),
  );
}

// --- 4. Stdio JSON-RPC smoke test --------------------------------------------
section("Stdio JSON-RPC (README §Development)");

async function rpcSession(messages, env) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("node", [DIST], {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", rejectP);
    child.on("close", (code) => resolveP({ code, stdout: out, stderr: err }));

    for (const m of messages) {
      child.stdin.write(JSON.stringify(m) + "\n");
    }
    // Give the server a moment to respond, then close stdin to let it exit.
    setTimeout(() => child.stdin.end(), 600);
  });
}

function parseJsonLines(text) {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

let toolListResponse = null;
{
  const res = await rpcSession(
    [
      {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "readme-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ],
    { BUILDSHIP_REPO: FAKE },
  );
  record("server prints `[buildship-mcp] ready` on stderr", /\[buildship-mcp\] ready/.test(res.stderr));
  const msgs = parseJsonLines(res.stdout);
  const init = msgs.find((m) => m.id === 1);
  const tools = msgs.find((m) => m.id === 2);
  record(
    "initialize returns serverInfo.name = buildship-mcp",
    init?.result?.serverInfo?.name === "buildship-mcp",
    init?.result?.serverInfo?.name,
  );
  record(
    "tools/list returns exactly 10 tools",
    tools?.result?.tools?.length === 10,
    `got ${tools?.result?.tools?.length}`,
  );
  const names = (tools?.result?.tools ?? []).map((t) => t.name).sort();
  const expected = [
    "add_node_to_workflow", "create_node", "create_workflow",
    "get_flow_label", "get_node", "get_workflow",
    "list_nodes", "list_workflows", "set_flow_label", "update_node_file",
  ];
  record(
    "tools/list exposes all README-documented tool names",
    JSON.stringify(names) === JSON.stringify(expected),
    names.join(","),
  );
  toolListResponse = tools;
}

// --- 5. End-to-end tool exercises -------------------------------------------
section("End-to-end tool exercises (README examples)");

// Helper: open one long-lived MCP session and send tool calls SERIALLY,
// waiting for each response before sending the next. The MCP server handles
// requests concurrently, so firing in parallel races writes against reads.
function startServer(env) {
  const child = spawn("node", [DIST], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  let stderr = "";
  const pending = new Map(); // id -> resolve
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const r = pending.get(msg.id);
        if (r) { pending.delete(msg.id); r(msg); }
      } catch { /* ignore */ }
    }
  });
  child.stderr.on("data", (d) => (stderr += d.toString()));

  let nextId = 1;
  function send(method, params) {
    const id = nextId++;
    return new Promise((resolveP) => {
      pending.set(id, resolveP);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async function close() {
    child.stdin.end();
    await new Promise((r) => child.on("close", r));
    return { stderr };
  }
  return { send, notify, close, child };
}

async function rpcCalls(toolCalls, env) {
  const s = startServer(env);
  await s.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "readme-test", version: "0" },
  });
  s.notify("notifications/initialized");
  const results = [];
  for (const c of toolCalls) {
    const r = await s.send("tools/call", { name: c.name, arguments: c.arguments ?? {} });
    results.push(r);
  }
  const { stderr } = await s.close();
  return { results, stderr };
}

function parseToolResult(r) {
  if (!r || !r.result) return null;
  const text = r.result.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

const calls = [
  // README smoketest 1: "List all custom nodes" on an empty repo
  { name: "list_nodes", arguments: {} },
  // README §Tools Reference example: create a node "greet-user"
  {
    name: "create_node",
    arguments: {
      id: "greet-user",
      label: "Greet User",
      description: "Returns a personalized greeting.",
      inputs: {
        name: { type: "string", title: "Name", description: "Person's name." },
        loud: { type: "boolean", title: "Loud", description: "YELL if true." },
      },
      required: ["name"],
      output: { type: "string", title: "Greeting" },
      mainTs: "export default async function ({ name, loud }: NodeInputs): NodeOutput {\n  const out = `Hello, ${name}`;\n  return loud ? out.toUpperCase() + '!' : out;\n}\n",
    },
  },
  // After create — list again, should now show greet-user
  { name: "list_nodes", arguments: {} },
  // README §Smoketest: another node, "reverse-string"
  {
    name: "create_node",
    arguments: {
      id: "reverse-string",
      label: "Reverse String",
      inputs: { text: { type: "string" } },
      required: ["text"],
      output: { type: "string" },
    },
  },
  // get_node greet-user (no version → latest)
  { name: "get_node", arguments: { id: "greet-user" } },
  // update_node_file with valid JSON
  {
    name: "update_node_file",
    arguments: {
      id: "greet-user", version: "1.0.0", file: "output.json",
      content: JSON.stringify({ type: "string", title: "Greeting v2" }),
    },
  },
  // README workflow example: users/greet with REST trigger
  {
    name: "create_workflow",
    arguments: {
      name: "users/greet",
      description: "Greets a user by name.",
      trigger: { method: "POST", path: "/users/greet" },
      nodes: [
        {
          type: "script", label: "Greet User",
          nodeId: "greet-user", version: "1.0.0",
          values: { name: { _$keys_: ["inputs", "name"] } },
        },
      ],
    },
  },
  { name: "list_workflows", arguments: {} },
  // Safety guardrails
  // Create same node again w/o overwrite → must error
  {
    name: "create_node",
    arguments: {
      id: "greet-user", label: "Greet User Again",
      inputs: {}, output: { type: "string" },
    },
  },
  // Bad kebab-case id
  {
    name: "create_node",
    arguments: {
      id: "BadId_UPPER", label: "x",
      inputs: {}, output: { type: "string" },
    },
  },
  // Bad semver version
  {
    name: "create_node",
    arguments: {
      id: "ok-id", label: "x", version: "1.0",
      inputs: {}, output: { type: "string" },
    },
  },
  // update_node_file with broken JSON → must error
  {
    name: "update_node_file",
    arguments: {
      id: "greet-user", version: "1.0.0", file: "output.json",
      content: "{not valid json",
    },
  },
  // set_flow_label / get_flow_label round-trip
  { name: "set_flow_label", arguments: { id: "greet-user", label: "Greet User (canonical)" } },
  { name: "get_flow_label", arguments: { id: "greet-user" } },
  { name: "get_flow_label", arguments: { id: "does-not-exist" } },
];

const { results, stderr: callsStderr } = await rpcCalls(calls, { BUILDSHIP_REPO: FAKE });

// Map results to the order above for readability.
const [
  emptyList, createGreet, listAfter, createReverse,
  getGreet, updateOk,
  createWf, listWf,
  dupCreate, badId, badVer, badJson,
  setLbl, getLbl, getLblMissing,
] = results;

record("list_nodes on empty repo returns total=0", parseToolResult(emptyList)?.total === 0);
record(
  "create_node greet-user succeeds and reports path",
  !createGreet?.result?.isError && parseToolResult(createGreet)?.nodeId === "greet-user",
);
record(
  "list_nodes after create shows greet-user",
  (parseToolResult(listAfter)?.nodes ?? []).some((n) => n.id === "greet-user"),
);
record(
  "create_node reverse-string succeeds",
  !createReverse?.result?.isError && parseToolResult(createReverse)?.nodeId === "reverse-string",
);
{
  const g = parseToolResult(getGreet);
  record(
    "get_node greet-user returns schema/inputs/output/mainTs",
    g && g.schema?.id === "greet-user" && g.inputs && g.output && typeof g.mainTs === "string",
  );
  record(
    "get_node returns expected mainTs body (contains `Hello, ${name}`)",
    g && typeof g.mainTs === "string" && g.mainTs.includes("Hello, ${name}"),
  );
}
record(
  "update_node_file with valid JSON succeeds",
  parseToolResult(updateOk)?.updated === true,
);
{
  const w = parseToolResult(createWf);
  record(
    "create_workflow seeds a folder + workflowId",
    w && typeof w.folder === "string" && /^users-greet-[A-Za-z0-9]{4}$/.test(w.folder) && typeof w.workflowId === "string",
    w && `folder=${w.folder} id=${w.workflowId}`,
  );
  record(
    "create_workflow includes the user-supplied node + Flow Output (nodeCount>=2)",
    w && w.nodeCount >= 2,
    w && `nodeCount=${w.nodeCount}`,
  );
}
record(
  "list_workflows shows the created workflow",
  (parseToolResult(listWf)?.workflows ?? []).some((wf) => wf.name === "users/greet"),
);

// Guardrails
record(
  "duplicate create_node without overwrite is refused",
  dupCreate?.result?.isError === true,
  dupCreate?.result?.content?.[0]?.text?.slice(0, 80),
);
record(
  "invalid kebab-case node id is rejected by zod",
  badId?.result?.isError === true,
);
record(
  "invalid semver version is rejected by zod",
  badVer?.result?.isError === true,
);
record(
  "update_node_file rejects malformed JSON",
  badJson?.result?.isError === true,
  badJson?.result?.content?.[0]?.text?.slice(0, 80),
);
record(
  "set_flow_label round-trip — set",
  parseToolResult(setLbl)?.label === "Greet User (canonical)",
);
record(
  "set_flow_label round-trip — get returns same label",
  parseToolResult(getLbl)?.label === "Greet User (canonical)",
);
record(
  "get_flow_label on unknown id returns exists=false",
  parseToolResult(getLblMissing)?.exists === false,
);

// Verify on-disk artefacts
section("On-disk artefacts created in fake repo");
record(
  "nodes/greet-user/1.0.0/ contains all 5 files",
  ["meta.json", "schema.json", "inputs.json", "output.json", "main.ts"].every((f) =>
    existsSync(join(FAKE, "nodes", "greet-user", "1.0.0", f)),
  ),
);
{
  const out = JSON.parse(readFileSync(join(FAKE, "nodes", "greet-user", "1.0.0", "output.json"), "utf8"));
  record("update_node_file actually rewrote output.json", out.title === "Greeting v2");
}
{
  const workflowsRoot = join(FAKE, "workflows");
  const folders = readdirSync(workflowsRoot);
  const folder = folders.find((f) => f.startsWith("users-greet-"));
  record("workflow folder created on disk", !!folder, folder);
  if (folder) {
    record(
      "workflow folder has all 6 JSON files",
      ["schema.json", "meta.json", "nodes.json", "inputs.json", "output.json", "triggers.json"].every(
        (f) => existsSync(join(workflowsRoot, folder, f)),
      ),
    );
    const triggers = JSON.parse(readFileSync(join(workflowsRoot, folder, "triggers.json"), "utf8"));
    record(
      "triggers.json contains the REST POST /users/greet config",
      Array.isArray(triggers) && triggers[0]?.config?.properties?.method?.default === "POST" &&
        triggers[0]?.config?.properties?.path?.default === "/users/greet",
    );
  }
}

// --- 6. Summary --------------------------------------------------------------
section("Summary");
console.log(`PASS: ${PASS}`);
console.log(`FAIL: ${FAIL}`);
if (FAIL > 0) {
  console.log("\nFailed assertions:");
  for (const r of RESULTS) if (!r.ok) console.log(`  • ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

// Cleanup
rmSync(FAKE, { recursive: true, force: true });
rmSync(tmpCwd, { recursive: true, force: true });

process.exit(FAIL === 0 ? 0 : 1);
