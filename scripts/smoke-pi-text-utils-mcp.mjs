#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-text-utils/dist/src/mcp-server.js");

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
  await client.connect(transport);

  const list = await client.listTools();
  const toolNames = list.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["text_stats", "text_transform"]);
  console.log("✓ listed tools:", toolNames.join(", "));

  const transform = await client.callTool({
    name: "text_transform",
    arguments: { text: "Hello MCP Smoke", operation: "slugify" },
  });
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

  const stats = await client.callTool({
    name: "text_stats",
    arguments: { text: "one two\nthree" },
  });
  assert.deepEqual(stats.structuredContent, {
    characters: 13,
    words: 3,
    lines: 2,
    isEmpty: false,
  });
  assert.equal(stats.isError, false);
  console.log("✓ called text_stats");

  const invalid = await client.callTool({
    name: "text_transform",
    arguments: { text: "Hello", operation: "not-a-real-operation" },
  });
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
  await client.close();
}
