#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-text-utils/dist/src/mcp-server.js");
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

if (!existsSync(serverPath)) {
  console.error(`Missing built MCP server: ${serverPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:text-utils:smoke`.");
  process.exit(1);
}

let stderr = "";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: repoRoot,
  stderr: "pipe",
});
transport.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

const client = new Client({ name: "pi-text-utils-smoke", version: "0.1.0" });

try {
  await withTimeout(client.connect(transport), "MCP client connect");

  const list = await withTimeout(client.listTools(), "MCP listTools");
  const toolNames = list.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["text_stats", "text_transform"]);
  console.log("✓ listed tools:", toolNames.join(", "));

  const transform = await withTimeout(
    client.callTool({
      name: "text_transform",
      arguments: { text: "Hello MCP Smoke", operation: "slugify" },
    }),
    "MCP text_transform call",
  );
  assert.deepEqual(transform.content, [{ type: "text", text: "hello-mcp-smoke" }]);
  assert.deepEqual(transform.structuredContent, {
    input: "Hello MCP Smoke",
    output: "hello-mcp-smoke",
    operation: "slugify",
    inputLength: 15,
    outputLength: 15,
  });
  assert.equal(transform.isError, false);
  console.log("✓ called text_transform");

  const stats = await withTimeout(
    client.callTool({
      name: "text_stats",
      arguments: { text: "one two\nthree" },
    }),
    "MCP text_stats call",
  );
  assert.deepEqual(stats.structuredContent, {
    characters: 13,
    words: 3,
    lines: 2,
    isEmpty: false,
  });
  assert.equal(stats.isError, false);
  console.log("✓ called text_stats");

  const invalid = await withTimeout(
    client.callTool({
      name: "text_transform",
      arguments: { text: "Hello", operation: "not-a-real-operation" },
    }),
    "MCP invalid text_transform call",
  );
  assert.equal(invalid.isError, true);
  assert.ok(Array.isArray(invalid.content));
  assert.equal(invalid.content[0]?.type, "text");
  assert.match(invalid.content[0].text, /Invalid arguments for text_transform/);
  console.log("✓ invalid input returns tool error");

  console.log("\nMCP smoke test passed.");
} catch (error) {
  if (stderr.trim()) {
    console.error("\nServer stderr:\n" + stderr.trim());
  }
  throw error;
} finally {
  await withTimeout(client.close(), "MCP client close", 5_000).catch(() => undefined);
}
