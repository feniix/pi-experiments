#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMcpStdioServer } from "@feniix/pi-portable-tools/mcp";
import { loadConfigWithSources, resolveEffectiveConfig } from "./config.js";
import { ThoughtStorage } from "./storage.js";
import { createSequentialThinkingTools } from "./tools.js";

export interface CreateMcpSequentialThinkingToolsOptions {
  env?: Record<string, string | undefined>;
}

export function getSequentialThinkingPackageVersion(startUrl = import.meta.url): string {
  let currentDir = dirname(fileURLToPath(startUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = join(currentDir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@feniix/pi-sequential-thinking" && typeof pkg.version === "string") {
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

export function createMcpSequentialThinkingTools(options: CreateMcpSequentialThinkingToolsOptions = {}) {
  const env = options.env ?? process.env;
  const effectiveConfig = () => resolveEffectiveConfig({ env, config: loadConfigWithSources(undefined, { env }) });
  const initialConfig = effectiveConfig();
  const storage = new ThoughtStorage(initialConfig.storageDir);

  return createSequentialThinkingTools({
    storage,
    getMaxLimits() {
      const config = effectiveConfig();
      return { maxBytes: config.maxBytes, maxLines: config.maxLines };
    },
    getEffectiveConfig: effectiveConfig,
  });
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

if (isDirectExecution()) {
  try {
    await runMcpStdioServer({
      name: "pi-sequential-thinking",
      version: getSequentialThinkingPackageVersion(),
      tools: createMcpSequentialThinkingTools(),
      instructions:
        "Use these tools for structured sequential thinking. Tool behavior is shared with the native pi extension.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[pi-sequential-thinking-mcp] ${message}`);
    process.exitCode = 1;
  }
}
