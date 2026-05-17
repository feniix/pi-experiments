import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ThoughtStorage } from "./storage.js";
import { registerSequentialThinkingPiTools } from "./pi-registration.js";
import { createSequentialThinkingTools } from "./tools.js";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError: boolean }>;
}

test("registerSequentialThinkingPiTools maps portable tools to source-compatible pi handlers", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-pi-registration-"));
  const tools = createSequentialThinkingTools({
    storage: new ThoughtStorage(storageDir),
    getMaxLimits: () => ({ maxBytes: 51200, maxLines: 2000 }),
  });
  const registered: RegisteredTool[] = [];

  registerSequentialThinkingPiTools(
    { registerTool(tool: RegisteredTool) { registered.push(tool); } },
    tools,
  );

  assert.deepEqual(
    registered.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );

  const processTool = registered.find((tool) => tool.name === "process_thought");
  assert.ok(processTool);
  const updates: unknown[] = [];
  const result = await processTool.execute(
    "call-1",
    {
      thought: "Pi wrapper thought",
      thought_number: 1,
      total_thoughts: 1,
      next_thought_needed: false,
      stage: "Analysis",
    },
    undefined,
    (update) => updates.push(update),
    undefined,
  );

  assert.deepEqual(updates, [{ content: [{ type: "text", text: "Processing thought..." }], details: { status: "pending" } }]);
  assert.equal(result.isError, false);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.details.tool, "process_thought");

  const invalid = await processTool.execute(
    "call-2",
    {
      thought: "   ",
      thought_number: 1,
      total_thoughts: 1,
      next_thought_needed: false,
      stage: "Analysis",
    },
    undefined,
    undefined,
    undefined,
  );
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /Sequential Thinking error/);
  assert.deepEqual(invalid.details.validationErrors, [
    { field: "thought", message: "Thought content cannot be empty" },
  ]);
});
