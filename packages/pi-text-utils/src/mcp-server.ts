#!/usr/bin/env node
import { runMcpStdioServer } from "./adapters/mcp.js";
import { textUtilsTools } from "./tools/index.js";

try {
  await runMcpStdioServer(textUtilsTools);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[pi-text-utils-mcp] ${message}`);
  process.exitCode = 1;
}
