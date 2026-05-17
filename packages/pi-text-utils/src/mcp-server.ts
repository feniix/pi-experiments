#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMcpStdioServer } from "@feniix/pi-portable-tools/mcp";
import { textUtilsTools } from "./tools/index.js";

function getPackageVersion(startUrl = import.meta.url): string {
  let currentDir = dirname(fileURLToPath(startUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = join(currentDir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@feniix/pi-text-utils" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // Keep walking up until we find the package root.
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return "0.0.0";
}

try {
  await runMcpStdioServer({
    name: "pi-text-utils",
    version: getPackageVersion(),
    tools: textUtilsTools,
    instructions:
      "Use these tools for simple text transformation and text statistics. Tool behavior is shared with the native pi extension.",
  });
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[pi-text-utils-mcp] ${message}`);
  process.exitCode = 1;
}
