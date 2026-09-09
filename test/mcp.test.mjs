import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

let tempRepo;
let client;
let transport;
let diagnostics = "";

before(async () => {
  tempRepo = await mkdtemp(path.join(tmpdir(), "bs-mcp-"));
  await Promise.all(
    ["nodes", "workflows", "flow-id-to-label"].map((name) => mkdir(path.join(tempRepo, name))),
  );
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      `globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: "v9.0.0", draft: false, prerelease: false }), { status: 200 }); await import(${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)});`,
    ],
    env: { ...process.env, BUILDSHIP_REPO: tempRepo },
    stderr: "pipe",
  });
  transport.stderr.on("data", (chunk) => {
    diagnostics += chunk.toString();
  });
  client = new Client({ name: "buildship-integration-test", version: "1.0.0" });
  await client.connect(transport);
});

after(async () => {
  try {
    await client?.close();
  } finally {
    if (tempRepo) await rm(tempRepo, { recursive: true, force: true });
  }
});

describe("MCP stdio protocol", { timeout: 30_000 }, () => {
  it("initializes and advertises consistent tool schemas and behavior", async () => {
    assert.equal(client.getServerVersion().name, "buildship-mcp");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(client.getServerVersion().version, pkg.version);
    assert.deepEqual(client.getServerCapabilities(), { tools: {} });
    const { tools } = await client.listTools();
    const second = await client.listTools();
    assert.deepEqual(second.tools, tools);
    assert.equal(tools.length, 13);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
    const readers = new Set([
      "check_for_updates",
      "list_nodes",
      "get_node",
      "list_workflows",
      "get_workflow",
      "get_flow_label",
      "validate_deployment",
    ]);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.inputSchema.$schema, "http://json-schema.org/draft-07/schema#");
      assert.equal(tool.annotations.readOnlyHint, readers.has(tool.name), tool.name);
      assert.equal(
        tool.annotations.openWorldHint,
        ["sync_to_git", "check_for_updates"].includes(tool.name),
        tool.name,
      );
      if (!readers.has(tool.name)) {
        assert.equal(tool.annotations.destructiveHint, true, tool.name);
        assert.equal(tool.annotations.idempotentHint, false, tool.name);
      }
    }
  });

  it("returns a successful read and keeps startup diagnostics on stderr", async () => {
    const result = await client.callTool({ name: "list_nodes", arguments: {} });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { total: 0, returned: 0, nodes: [] });
    assert.match(diagnostics, /\[buildship-mcp\] ready/);
  });

  it("returns invalid tool input as an actionable tool error", async () => {
    const result = await client.callTool({ name: "get_node", arguments: { id: "../escape" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Invalid input for get_node: id:/);
  });

  it("exposes update availability through an ordinary MCP tool result", async () => {
    const result = await client.callTool({ name: "check_for_updates", arguments: {} });
    assert.notEqual(result.isError, true);
    const report = JSON.parse(result.content[0].text);
    assert.equal(report.status, "update_available");
    assert.equal(report.latestVersion, "9.0.0");
    assert.equal(report.updateAvailable, true);
    assert.equal(
      report.releaseUrl,
      "https://github.com/sgardoll/buildship-mcp-server/releases/tag/v9.0.0",
    );
  });

  it("returns an unknown tool as a protocol error", async () => {
    await assert.rejects(client.callTool({ name: "missing_tool", arguments: {} }), (error) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, ErrorCode.InvalidParams);
      assert.match(error.message, /Unknown tool: missing_tool/);
      return true;
    });
  });

  it("returns execution failures without losing the connection", async () => {
    const result = await client.callTool({ name: "get_node", arguments: { id: "missing-node" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /missing-node/);
    assert.equal((await client.listTools()).tools.length, 13);
  });

  it("supports a mutation that reenters the repository lock", async () => {
    const written = await client.callTool({
      name: "set_flow_label",
      arguments: { id: "integration-label", label: "Integration label" },
    });
    assert.notEqual(written.isError, true, written.content[0].text);
    const read = await client.callTool({
      name: "get_flow_label",
      arguments: { id: "integration-label" },
    });
    assert.notEqual(read.isError, true, read.content[0].text);
    assert.equal(JSON.parse(read.content[0].text).label, "Integration label");
  });

  it("marks a failed Git push as an error while preserving the local commit", async () => {
    const git = (...args) =>
      execFileSync("git", args, { cwd: tempRepo, encoding: "utf8", stdio: "pipe" }).trim();
    git("init", "-q");
    git("config", "user.name", "MCP Integration Test");
    git("config", "user.email", "mcp-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    await mkdir(path.join(tempRepo, "empty-hooks"));
    git("config", "core.hooksPath", path.join(tempRepo, "empty-hooks"));
    await writeFile(path.join(tempRepo, "flow-id-to-label", "push-test.txt"), "Push test\n");
    const result = await client.callTool({
      name: "sync_to_git",
      arguments: { message: "Exercise local commit without a remote", push: true },
    });
    assert.equal(result.isError, true);
    const report = JSON.parse(result.content[0].text);
    assert.equal(report.committed, true);
    assert.equal(report.pushed, false);
    assert.equal(report.commitHash, git("rev-parse", "HEAD"));
    assert.equal(typeof report.pushError, "string");
    assert.ok(report.pushError.length > 0);
  });
});
