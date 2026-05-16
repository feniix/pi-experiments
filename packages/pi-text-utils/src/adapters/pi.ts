import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { PortableTool, PortableToolResult } from "../portable/define-tool.js";

type PiToolRegistration = Pick<ExtensionAPI, "registerTool">;

type PiContent = { type: "text"; text: string };

function toPiDetails(result: PortableToolResult): Record<string, unknown> {
  return result.details ?? result.structuredContent ?? {};
}

export function registerPiTools(pi: PiToolRegistration, tools: readonly PortableTool<TSchema>[]): void {
  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const result = await tool.execute(params, {
          host: "pi",
          signal,
          progress(update) {
            onUpdate?.({
              content: [{ type: "text", text: update.text } satisfies PiContent],
              details: toPiDetails(update),
            });
          },
        });

        return {
          content: [{ type: "text", text: result.text } satisfies PiContent],
          details: toPiDetails(result),
        };
      },
    });
  }
}
