import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { definePortableTool } from "@feniix/pi-portable-tools";
import { Type } from "typebox";
import { registerSequentialThinkingPiTools } from "./pi-registration.js";
import { ThoughtStorage } from "./storage.js";
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
    {
      registerTool(tool: RegisteredTool) {
        registered.push(tool);
      },
    },
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

  assert.deepEqual(updates, [
    { content: [{ type: "text", text: "Processing thought..." }], details: { status: "pending" } },
  ]);
  assert.equal(result.isError, false);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.details.tool, "process_thought");
  assert.equal((result.details.result as { receipt?: { operation?: unknown } }).receipt?.operation, "process_thought");

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

  const invalidStage = await processTool.execute("call-3", {
    thought: "Invalid stage",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Nope",
  });
  assert.equal(invalidStage.isError, true);
  assert.deepEqual(
    (invalidStage.details.validationErrors as Array<{ field: string }>).map((error) => error.field),
    ["stage"],
  );
  assert.match(JSON.stringify(invalidStage.details.validationErrors), /Invalid thinking stage/);

  const sequentialTool = registered.find((tool) => tool.name === "sequential_think");
  assert.ok(sequentialTool);
  const fractionalSequential = await sequentialTool.execute("call-4", {
    topic: "fractional",
    num_thoughts: 3.5,
  });
  assert.equal(fractionalSequential.isError, true);
  assert.deepEqual(fractionalSequential.details.validationErrors, [
    { field: "num_thoughts", message: "num_thoughts must be an integer" },
  ]);
});

test("registerSequentialThinkingPiTools returns source-compatible fallback errors for unexpected throws", async () => {
  const throwingTool = definePortableTool({
    name: "process_thought",
    title: "Throwing Tool",
    description: "Throws for pi wrapper fallback coverage.",
    parameters: Type.Object({}, { additionalProperties: true }),
    execute() {
      throw new Error("unexpected boom");
    },
  });
  const registered: RegisteredTool[] = [];
  registerSequentialThinkingPiTools(
    {
      registerTool(tool: RegisteredTool) {
        registered.push(tool);
      },
    },
    [throwingTool],
  );

  const result = await registered[0].execute("call-throw", {});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Sequential Thinking error: unexpected boom");
  assert.deepEqual(result.details, { tool: "process_thought", truncated: false, error: "unexpected boom" });
});
