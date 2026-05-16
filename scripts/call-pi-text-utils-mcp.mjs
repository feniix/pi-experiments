#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-text-utils/dist/src/mcp-server.js");
const [toolName, rawArgs = "{}"] = process.argv.slice(2);
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

function usage() {
  console.error("Usage:");
  console.error("  npm run mcp:text-utils:call -- <tool-name> '<json-args>'");
  console.error("");
  console.error("Examples:");
  console.error("  npm run mcp:text-utils:call -- text_transform '{\"text\":\"Hello MCP\",\"operation\":\"reverse\"}'");
  console.error("  npm run mcp:text-utils:call -- text_stats '{\"text\":\"one two\\nthree\"}'");
}

if (!toolName) {
  usage();
  process.exit(1);
}

if (!existsSync(serverPath)) {
  console.error(`Missing built MCP server: ${serverPath}`);
  console.error("Run `npm run build` first, or use the npm script wrapper shown above.");
  process.exit(1);
}

let parsedArgs;
try {
  parsedArgs = JSON.parse(rawArgs);
} catch (error) {
  console.error(`Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`);
  usage();
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

const client = new Client({ name: "pi-text-utils-manual-call", version: "0.1.0" });

try {
  await withTimeout(client.connect(transport), "MCP client connect");
  const list = await withTimeout(client.listTools(), "MCP listTools");
  const names = new Set(list.tools.map((tool) => tool.name));
  if (!names.has(toolName)) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Available tools: ${[...names].sort().join(", ")}`);
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const result = await withTimeout(
    client.callTool({ name: toolName, arguments: parsedArgs }),
    `MCP ${toolName} call`,
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (stderr.trim()) {
    console.error("\nServer stderr:\n" + stderr.trim());
  }
  throw error;
} finally {
  await withTimeout(client.close(), "MCP client close", 5_000).catch(() => undefined);
}
