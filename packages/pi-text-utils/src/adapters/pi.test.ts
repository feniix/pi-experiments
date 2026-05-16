import assert from "node:assert/strict";
import test from "node:test";
import { textUtilsTools } from "../tools/index.js";
import { registerPiTools } from "./pi.js";

test("registerPiTools registers every portable tool with pi metadata", () => {
  const registered: Array<Record<string, unknown>> = [];
  const pi = {
    registerTool(tool: Record<string, unknown>) {
      registered.push(tool);
    },
  };

  registerPiTools(pi as never, textUtilsTools);

  assert.deepEqual(
    registered.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
    })),
    textUtilsTools.map((tool) => ({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      parameters: tool.parameters,
    })),
  );
});

test("registered pi tool delegates execution to the portable tool", async () => {
  const registered: Array<{ execute: Function; name: string }> = [];
  const pi = {
    registerTool(tool: { execute: Function; name: string }) {
      registered.push(tool);
    },
  };

  registerPiTools(pi as never, textUtilsTools);
  const transform = registered.find((tool) => tool.name === "text_transform");
  assert.ok(transform);

  const updates: unknown[] = [];
  const result = await transform.execute(
    "tool-call-1",
    { text: "Hello", operation: "reverse" },
    undefined,
    (update: unknown) => updates.push(update),
    {},
  );

  assert.deepEqual(result, {
    content: [{ type: "text", text: "olleH" }],
    details: {
      input: "Hello",
      output: "olleH",
      operation: "reverse",
      inputLength: 5,
      outputLength: 5,
    },
  });
  assert.deepEqual(updates, []);
});
