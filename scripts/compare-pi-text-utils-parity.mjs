#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerPiTools } from "../packages/pi-text-utils/dist/src/adapters/pi.js";
import { textUtilsTools } from "../packages/pi-text-utils/dist/src/tools/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-text-utils/dist/src/mcp-server.js");

if (!existsSync(serverPath)) {
  console.error(`Missing built MCP server: ${serverPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:text-utils:parity`.");
  process.exit(1);
}

const registeredPiTools = new Map();
registerPiTools(
  {
    registerTool(tool) {
      registeredPiTools.set(tool.name, tool);
    },
  },
  textUtilsTools,
);

function textFromContent(content) {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

function normalizePiResult(result) {
  return {
    text: textFromContent(result.content),
    structured: result.details ?? {},
    isError: result.isError ?? false,
  };
}

function normalizeMcpResult(result) {
  return {
    text: textFromContent(result.content),
    structured: result.structuredContent ?? {},
    isError: result.isError ?? false,
  };
}

async function callPiTool(name, args) {
  const tool = registeredPiTools.get(name);
  assert.ok(tool, `pi tool not registered: ${name}`);
  try {
    const result = await tool.execute("parity-check", args, undefined, undefined, {});
    return normalizePiResult(result);
  } catch (error) {
    if (error instanceof Error && "isPortableToolError" in error) {
      return {
        text: error.message,
        structured: error.details ?? {},
        isError: true,
      };
    }
    throw error;
  }
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

const client = new Client({ name: "pi-text-utils-parity", version: "0.1.0" });

const cases = [
  {
    label: "text_transform slugify",
    name: "text_transform",
    args: { text: "Hello, Portable pi + MCP Tools!", operation: "slugify" },
  },
  {
    label: "text_transform uppercase",
    name: "text_transform",
    args: { text: "portable tool adapters", operation: "uppercase" },
  },
  {
    label: "text_stats uppercase output",
    name: "text_stats",
    args: { text: "PORTABLE TOOL ADAPTERS" },
  },
  {
    label: "text_transform invalid operation",
    name: "text_transform",
    args: { text: "Hello", operation: "unknown" },
  },
];

try {
  await client.connect(transport);

  for (const testCase of cases) {
    const piResult = await callPiTool(testCase.name, testCase.args);
    const mcpResult = normalizeMcpResult(
      await client.callTool({ name: testCase.name, arguments: testCase.args }),
    );

    assert.deepEqual(mcpResult, piResult);
    console.log(`✓ ${testCase.label} matched`);
    console.log(`  ${piResult.text.replace(/\n/g, "\\n")}`);
  }

  console.log("\npi adapter and MCP stdio behavior match for valid and invalid portable-tool calls.");
} catch (error) {
  if (stderr.trim()) {
    console.error("\nServer stderr:\n" + stderr.trim());
  }
  throw error;
} finally {
  await client.close();
}
