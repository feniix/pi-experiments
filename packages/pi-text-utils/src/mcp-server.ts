#!/usr/bin/env node
import { runMcpStdioServer } from "@feniix/pi-portable-tools/mcp";
import { getTextUtilsPackageVersion } from "./package-metadata.js";
import { textUtilsTools } from "./tools/index.js";

try {
  await runMcpStdioServer({
    name: "pi-text-utils",
    version: getTextUtilsPackageVersion(),
    tools: textUtilsTools,
    instructions:
      "Use these tools for simple text transformation and text statistics. Tool behavior is shared with the native pi extension.",
  });
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[pi-text-utils-mcp] ${message}`);
  process.exitCode = 1;
}
