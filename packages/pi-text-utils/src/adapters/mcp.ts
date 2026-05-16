import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import type { PortableTool, PortableToolResult } from "../portable/define-tool.js";
import { executePortableTool } from "../portable/execute-tool.js";

type McpToolRegistration = {
  registerTool(name: string, config: Record<string, unknown>, callback: (args: unknown, extra: unknown) => unknown): unknown;
};

type McpContent = { type: "text"; text: string };

function toMcpResult(result: PortableToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: result.text } satisfies McpContent],
    structuredContent: result.structuredContent ?? result.details,
    isError: result.isError ?? false,
  };
}

function signalFromExtra(extra: unknown): AbortSignal | undefined {
  if (!extra || typeof extra !== "object" || !("signal" in extra)) {
    return undefined;
  }
  const signal = (extra as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

export function registerMcpTools(server: McpToolRegistration, tools: readonly PortableTool<TSchema>[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.parameters,
      },
      async (args: unknown, extra: unknown) => {
        const result = await executePortableTool(tool, args, {
          host: "mcp",
          signal: signalFromExtra(extra),
        });
        return toMcpResult(result);
      },
    );
  }
}

export function createMcpServer(tools: readonly PortableTool<TSchema>[]): Server {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server(
    { name: "pi-text-utils", version: "0.1.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Use these tools for simple text transformation and text statistics. Tool behavior is shared with the native pi extension.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(
      (tool): Tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.parameters as Tool["inputSchema"],
      }),
    ),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      } satisfies CallToolResult;
    }

    const result = await executePortableTool(tool, request.params.arguments ?? {}, {
      host: "mcp",
      signal: signalFromExtra(extra),
    });
    return toMcpResult(result);
  });

  return server;
}

export async function runMcpStdioServer(tools: readonly PortableTool<TSchema>[]): Promise<void> {
  const server = createMcpServer(tools);
  await server.connect(new StdioServerTransport());
}
