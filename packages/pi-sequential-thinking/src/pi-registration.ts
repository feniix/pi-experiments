import type { TSchema } from "typebox";
import type { PortableTool, PortableToolResult } from "@feniix/pi-portable-tools";
import { executePortableTool } from "@feniix/pi-portable-tools";

export type PiContent = { type: "text"; text: string };
export type PiToolUpdate = { content: PiContent[]; details: Record<string, unknown> };
export type PiToolResult = { content: PiContent[]; details: Record<string, unknown>; isError: boolean };

export type PiToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: PiToolUpdate) => void,
    ctx?: unknown,
  ): Promise<PiToolResult>;
};

export type PiToolRegistration = {
  registerTool(tool: PiToolDefinition): unknown;
};

const pendingMessages: Record<string, string> = {
  process_thought: "Processing thought...",
  generate_summary: "Generating summary...",
  clear_history: "Clearing history...",
  export_session: "Exporting session...",
  import_session: "Importing session...",
  get_thinking_history: "Getting thinking history...",
  get_thinking_status: "Getting thinking status...",
  sequential_think: "Starting structured thinking process...",
};

function toPiDetails(result: PortableToolResult): Record<string, unknown> {
  return result.structuredContent ?? result.details ?? {};
}

function toPiResult(result: PortableToolResult): PiToolResult {
  return {
    content: [{ type: "text", text: result.text }],
    details: toPiDetails(result),
    isError: result.isError ?? false,
  };
}

export function registerSequentialThinkingPiTools(pi: PiToolRegistration, tools: readonly PortableTool<TSchema>[]): void {
  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const pendingMessage = pendingMessages[tool.name];
        if (pendingMessage) {
          onUpdate?.({ content: [{ type: "text", text: pendingMessage }], details: { status: "pending" } });
        }

        try {
          const result = await executePortableTool(tool, params, { host: "pi", signal });
          return toPiResult(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Sequential Thinking error: ${message}` }],
            details: { tool: tool.name, truncated: false, error: message },
            isError: true,
          };
        }
      },
    });
  }
}
