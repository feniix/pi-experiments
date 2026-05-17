import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sequentialThinking from "../extensions/index.js";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: { required?: string[] };
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError: boolean }>;
}

function createMockPi(flags: Record<string, string | boolean | undefined> = {}) {
  const registeredFlags: string[] = [];
  const tools: RegisteredTool[] = [];
  return {
    registeredFlags,
    tools,
    registerFlag(name: string) {
      registeredFlags.push(name);
    },
    getFlag(name: string) {
      return flags[name];
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    on() {
      return undefined;
    },
  };
}

function getTool(mockPi: ReturnType<typeof createMockPi>, name: string): RegisteredTool {
  const tool = mockPi.tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

function parseToolJson(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text.replace(/\n\n\[Output truncated:[\s\S]*$/, ""));
}

test("extension registers source-compatible tools, schemas, and flags", () => {
  const mockPi = createMockPi();
  sequentialThinking(mockPi as unknown as ExtensionAPI);

  assert.deepEqual(
    mockPi.tools.map((tool) => tool.name),
    [
      "process_thought",
      "generate_summary",
      "clear_history",
      "export_session",
      "import_session",
      "get_thinking_history",
      "get_thinking_status",
      "sequential_think",
    ],
  );
  assert.deepEqual(
    mockPi.registeredFlags,
    [
      "--seq-think-storage-dir",
      "--seq-think-config-file",
      "--seq-think-config",
      "--seq-think-max-bytes",
      "--seq-think-max-lines",
    ],
  );

  const required = getTool(mockPi, "process_thought").parameters.required ?? [];
  assert.equal(required.includes("thought_number"), false);
  assert.equal(required.includes("total_thoughts"), false);
  assert.equal(required.includes("next_thought_needed"), false);
});

test("pi runtime preserves named sessions, receipts, history, import/export, and sequential_think", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-tools-"));
  const exportPath = join(storageDir, "nested", "session.json");
  const legacyPath = join(storageDir, "legacy.json");
  const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
  sequentialThinking(mockPi as unknown as ExtensionAPI);

  const processTool = getTool(mockPi, "process_thought");
  const summaryTool = getTool(mockPi, "generate_summary");
  const clearTool = getTool(mockPi, "clear_history");
  const exportTool = getTool(mockPi, "export_session");
  const importTool = getTool(mockPi, "import_session");
  const historyTool = getTool(mockPi, "get_thinking_history");
  const statusTool = getTool(mockPi, "get_thinking_status");
  const sequentialTool = getTool(mockPi, "sequential_think");
  const updates: unknown[] = [];

  const processResult = await processTool.execute(
    "call-1",
    {
      thought: "Use aliases and grow depth",
      thoughtNumber: 5,
      totalThoughts: 3,
      nextThoughtNeeded: true,
      stage: "Analysis",
      tags: ["runtime"],
      sessionId: "research",
    },
    undefined,
    (update) => updates.push(update),
    undefined,
  );
  assert.equal(processResult.isError, false);
  assert.deepEqual(updates[0], { content: [{ type: "text", text: "Processing thought..." }], details: { status: "pending" } });
  assert.equal(parseToolJson(processResult).receipt.totalThoughtsAdjusted.to, 5);

  await processTool.execute(
    "call-2",
    {
      thought: "Default thought",
      thought_number: 1,
      total_thoughts: 1,
      next_thought_needed: false,
      stage: "Analysis",
    },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(parseToolJson(await summaryTool.execute("call-3", { sessionId: "research" })).summary.totalThoughts, 1);

  const exportResult = await exportTool.execute("call-4", { file_path: exportPath, sessionId: "research" });
  assert.equal(exportResult.isError, false);
  assert.equal(existsSync(exportPath), true);
  assert.equal(JSON.parse(readFileSync(exportPath, "utf-8")).sessionId, "research");

  assert.equal(parseToolJson(await clearTool.execute("call-5", { sessionId: "research" })).receipt.postCount, 0);

  writeFileSync(
    legacyPath,
    JSON.stringify([
      {
        id: "legacy-id",
        thought: "Legacy thought",
        thought_number: 4,
        total_thoughts: 4,
        next_thought_needed: false,
        stage: "Conclusion",
        timestamp: "2026-05-16T00:00:00.000Z",
      },
    ]),
    "utf-8",
  );
  assert.equal(parseToolJson(await importTool.execute("call-6", { file_path: legacyPath, sessionId: "legacy-import" })).receipt.postCount, 1);
  assert.equal(parseToolJson(await historyTool.execute("call-7", { sessionId: "legacy-import" })).thoughts[0].thoughtNumber, 4);

  const sequential = parseToolJson(
    await sequentialTool.execute("call-8", { topic: "Database migration strategy", num_thoughts: 5, sessionId: "scratch" }),
  );
  assert.equal(sequential.receipt.postCount, 5);

  const status = parseToolJson(await statusTool.execute("call-9", {}));
  assert.equal(JSON.stringify(status).includes("Default thought"), false);
  assert.equal(status.effectiveConfig.sources.storageDir, "flag");
});

test("pi runtime returns structured validation errors", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-errors-"));
  const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
  sequentialThinking(mockPi as unknown as ExtensionAPI);

  const processTool = getTool(mockPi, "process_thought");
  const summaryTool = getTool(mockPi, "generate_summary");
  const importTool = getTool(mockPi, "import_session");
  const historyTool = getTool(mockPi, "get_thinking_history");

  const invalidThought = await processTool.execute("call-10", {
    thought: "   ",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
  });
  assert.equal(invalidThought.isError, true);
  assert.match(invalidThought.content[0].text, /Thought content cannot be empty/);
  assert.deepEqual(invalidThought.details.validationErrors, [
    { field: "thought", message: "Thought content cannot be empty" },
  ]);

  const missingImport = await importTool.execute("call-11", { file_path: join(storageDir, "missing.json") });
  assert.equal(missingImport.isError, true);
  assert.match(missingImport.content[0].text, /File not found/);

  const conflictingSession = await summaryTool.execute("call-12", { session_id: "one", sessionId: "two" });
  assert.equal(conflictingSession.isError, true);
  assert.deepEqual(conflictingSession.details.validationErrors, [
    { field: "session_id", message: "Conflicting aliases for session_id" },
  ]);

  const conflictingHistory = await historyTool.execute("call-13", { include_full_thoughts: true, includeFullThoughts: false });
  assert.equal(conflictingHistory.isError, true);
  assert.deepEqual(conflictingHistory.details.validationErrors, [
    { field: "include_full_thoughts", message: "Conflicting aliases for include_full_thoughts" },
  ]);
});
