#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-sequential-thinking/dist/src/mcp-server.js");
const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-mcp-smoke-"));
writeFileSync(join(storageDir, "current_session.json"), "not valid json {{{{json", "utf-8");
const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout(promise, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function textFromContent(content) {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

function parseResult(result) {
  return JSON.parse(textFromContent(result.content).replace(/\n\n\[Output truncated:[\s\S]*$/, ""));
}

if (!existsSync(serverPath)) {
  console.error(`Missing built MCP server: ${serverPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:sequential-thinking:smoke`.");
  process.exit(1);
}

let stderr = "";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: repoRoot,
  env: {
    ...process.env,
    MCP_STORAGE_DIR: storageDir,
    SEQ_THINK_MAX_BYTES: "51200",
    SEQ_THINK_MAX_LINES: "2000",
  },
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

const client = new Client({ name: "pi-sequential-thinking-smoke", version: "0.1.0" });

try {
  await withTimeout(client.connect(transport), "MCP client connect");

  const list = await withTimeout(client.listTools(), "MCP listTools");
  const toolNames = list.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "process_thought",
    "generate_summary",
    "clear_history",
    "export_session",
    "import_session",
    "get_thinking_history",
    "get_thinking_status",
    "sequential_think",
  ]);
  console.log("✓ listed sequential-thinking tools");

  const processed = await withTimeout(
    client.callTool({
      name: "process_thought",
      arguments: {
        thought: "Smoke thought",
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        stage: "Analysis",
        sessionId: "smoke",
      },
    }),
    "MCP process_thought call",
  );
  assert.equal(processed.isError, false);
  assert.equal(parseResult(processed).receipt.sessionId, "smoke");
  console.log("✓ called process_thought");

  const history = await withTimeout(
    client.callTool({ name: "get_thinking_history", arguments: { sessionId: "smoke" } }),
    "MCP get_thinking_history call",
  );
  assert.equal(parseResult(history).totalThoughts, 1);
  console.log("✓ called get_thinking_history");

  const status = await withTimeout(
    client.callTool({ name: "get_thinking_status", arguments: {} }),
    "MCP get_thinking_status call",
  );
  assert.equal(parseResult(status).effectiveConfig.sources.storageDir, "env");
  console.log("✓ called get_thinking_status");

  const invalid = await withTimeout(
    client.callTool({
      name: "process_thought",
      arguments: {
        thought: "   ",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Analysis",
      },
    }),
    "MCP invalid process_thought call",
  );
  assert.equal(invalid.isError, true);
  assert.match(textFromContent(invalid.content), /Thought content cannot be empty/);
  console.log("✓ invalid input returns tool error");

  console.log("\nSequential-thinking MCP smoke test passed.");
} catch (error) {
  if (stderr.trim()) {
    console.error(`\nServer stderr:\n${stderr.trim()}`);
  }
  throw error;
} finally {
  await withTimeout(client.close(), "MCP client close", 5_000).catch(() => undefined);
}
