#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfigWithSources, resolveEffectiveConfig } from "./config.js";
import { ThoughtStorage } from "./storage.js";
import { createSequentialThinkingTools } from "./tools.js";

interface CreateMcpSequentialThinkingServerOptions extends CreateMcpSequentialThinkingToolsOptions {
  name?: string;
  version?: string;
  instructions?: string;
}

const sequentialThinkingOutputSchema = {
  type: "object",
  properties: {
    tool: { type: "string" },
    truncated: { type: "boolean" },
    truncation: { type: "object", additionalProperties: true },
    tempFile: { type: "string" },
    result: { type: "object", additionalProperties: true },
    error: { type: "string" },
    validationErrors: { type: "array", items: { type: "object", additionalProperties: true } },
  },
  required: ["tool", "truncated"],
  additionalProperties: true,
} as const;

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
    getEffectiveConfig() {
      const config = effectiveConfig();
      return {
        ...config,
        storageDir: initialConfig.storageDir,
        sources: { ...config.sources, storageDir: initialConfig.sources.storageDir },
      };
    },
  });
}

export function createMcpSequentialThinkingServer(options: CreateMcpSequentialThinkingServerOptions = {}): Server {
  const tools = createMcpSequentialThinkingTools(options);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server(
    {
      name: options.name ?? "pi-sequential-thinking",
      version: options.version ?? getSequentialThinkingPackageVersion(),
    },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        options.instructions ??
        "Use these tools for structured sequential thinking. Tool behavior is shared with the native pi extension.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(
      (tool): Tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.parameters as unknown as Tool["inputSchema"],
        outputSchema: sequentialThinkingOutputSchema as unknown as Tool["outputSchema"],
      }),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      } satisfies CallToolResult;
    }

    try {
      const result = await tool.execute(request.params.arguments ?? {}, { host: "mcp" });
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structuredContent ?? result.details,
        isError: result.isError ?? false,
      } satisfies CallToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      } satisfies CallToolResult;
    }
  });

  return server;
}

export async function runMcpSequentialThinkingStdioServer(
  options: CreateMcpSequentialThinkingServerOptions = {},
): Promise<void> {
  const server = createMcpSequentialThinkingServer(options);
  await server.connect(new StdioServerTransport());
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
    await runMcpSequentialThinkingStdioServer({
      name: "pi-sequential-thinking",
      version: getSequentialThinkingPackageVersion(),
      instructions:
        "Use these tools for structured sequential thinking. Tool behavior is shared with the native pi extension.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[pi-sequential-thinking-mcp] ${message}`);
    process.exitCode = 1;
  }
}
