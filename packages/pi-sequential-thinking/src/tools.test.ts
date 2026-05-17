import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { ThoughtStorage } from "./storage.js";
import { createSequentialThinkingTools } from "./tools.js";

function createHarness() {
  const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-tools-"));
  const storage = new ThoughtStorage(storageDir, { homeDir: storageDir });
  const tools = createSequentialThinkingTools({
    storage,
    getMaxLimits: () => ({ maxBytes: 51200, maxLines: 2000 }),
    getEffectiveConfig: () => ({
      storageDir,
      maxBytes: 51200,
      maxLines: 2000,
      sources: { storageDir: "flag", maxBytes: "default", maxLines: "default" },
    }),
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  async function call(name: string, args: Record<string, unknown> = {}) {
    const tool = byName.get(name);
    assert.ok(tool, `missing tool ${name}`);
    return executePortableTool(tool as PortableTool<TObject>, args, { host: "test" });
  }
  return { storageDir, tools, call };
}

function parseJsonResult(result: { text: string }) {
  return JSON.parse(result.text.replace(/\n\n\[Output truncated:[\s\S]*$/, ""));
}

test("defines the eight sequential-thinking portable tools", () => {
  const { tools } = createHarness();
  assert.deepEqual(
    tools.map((tool) => tool.name),
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
});

test("process_thought records analysis, receipts, aliases, and case-insensitive stages", async () => {
  const { call } = createHarness();

  const result = await call("process_thought", {
    thought: "Use aliases and grow depth",
    thoughtNumber: 5,
    totalThoughts: 3,
    nextThoughtNeeded: true,
    stage: "analysis",
    tags: ["runtime"],
    sessionId: "research",
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent?.tool, "process_thought");
  const processed = parseJsonResult(result);
  assert.equal(
    (result.structuredContent?.result as { receipt?: { operation?: unknown } }).receipt?.operation,
    "process_thought",
  );
  assert.equal(processed.thoughtAnalysis.currentThought.totalThoughts, 5);
  assert.deepEqual(processed.receipt, {
    operation: "process_thought",
    sessionId: "research",
    sessionLabel: "research",
    preCount: 0,
    postCount: 1,
    changed: true,
    savedAt: processed.receipt.savedAt,
    stateFingerprint: processed.receipt.stateFingerprint,
    totalThoughtsAdjusted: { from: 3, to: 5 },
  });
});

test("summary, history, clear, export, import, and sequential_think are session-scoped", async () => {
  const { call, storageDir } = createHarness();
  const exportPath = join(storageDir, "nested", "session.json");
  const legacyPath = join(storageDir, "legacy.json");

  await call("process_thought", {
    thought: "Default thought",
    thought_number: 1,
    total_thoughts: 2,
    next_thought_needed: true,
    stage: "Analysis",
  });
  await call("process_thought", {
    thought: "Research thought",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Conclusion",
    session_id: "research",
  });

  const summary = parseJsonResult(await call("generate_summary", { sessionId: "research" }));
  assert.equal(summary.summary.totalThoughts, 1);

  const exportResult = parseJsonResult(await call("export_session", { file_path: exportPath, sessionId: "research" }));
  assert.equal(exportResult.receipt.operation, "export_session");
  assert.equal(existsSync(exportPath), true);
  assert.equal(JSON.parse(readFileSync(exportPath, "utf-8")).sessionId, "research");

  const clear = parseJsonResult(await call("clear_history", { sessionId: "research" }));
  assert.deepEqual(clear.receipt, {
    operation: "clear_history",
    sessionId: "research",
    sessionLabel: "research",
    preCount: 1,
    postCount: 0,
    changed: true,
    savedAt: clear.receipt.savedAt,
    stateFingerprint: clear.receipt.stateFingerprint,
  });

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
  const importResult = parseJsonResult(
    await call("import_session", { file_path: legacyPath, sessionId: "legacy-import" }),
  );
  assert.equal(importResult.receipt.operation, "import_session");
  assert.equal(importResult.receipt.sessionId, "legacy-import");

  const importedHistory = parseJsonResult(await call("get_thinking_history", { sessionId: "legacy-import" }));
  assert.equal(importedHistory.thoughts[0].thoughtNumber, 4);

  const sequential = parseJsonResult(
    await call("sequential_think", { topic: "Database migration strategy", num_thoughts: 5, sessionId: "scratch" }),
  );
  assert.equal(sequential.receipt.operation, "sequential_think");
  assert.equal(sequential.receipt.postCount, 5);

  const defaultHistory = parseJsonResult(await call("get_thinking_history"));
  assert.equal(defaultHistory.totalThoughts, 1);
  assert.equal(defaultHistory.thoughts[0].thought, "Default thought");
});

test("history snippets and status are content-free when requested", async () => {
  const { call, storageDir } = createHarness();
  await call("process_thought", {
    thought: "Sensitive status thought",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
    tags: ["private"],
  });

  const history = parseJsonResult(await call("get_thinking_history", { includeFullThoughts: false }));
  assert.match(history.thoughts[0].snippet, /Sensitive/);
  assert.equal(history.thoughts[0].thought, undefined);

  const status = parseJsonResult(await call("get_thinking_status"));
  const serialized = JSON.stringify(status);
  assert.equal(status.totalThoughts, 1);
  assert.equal(status.effectiveConfig.sources.storageDir, "flag");
  assert.equal(serialized.includes("Sensitive status thought"), false);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes(storageDir), false);
});

test("invalid tool inputs return source-compatible error results", async () => {
  const { call, storageDir } = createHarness();
  const invalidThought = await call("process_thought", {
    thought: "   ",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
  });
  assert.equal(invalidThought.isError, true);
  assert.match(invalidThought.text, /Sequential Thinking error: thought: Thought content cannot be empty/);
  assert.deepEqual(invalidThought.structuredContent?.validationErrors, [
    { field: "thought", message: "Thought content cannot be empty" },
  ]);

  const missingImport = await call("import_session", { file_path: join(storageDir, "missing.json") });
  assert.equal(missingImport.isError, true);
  assert.match(missingImport.text, /File not found/);

  const conflictingSession = await call("generate_summary", { session_id: "one", sessionId: "two" });
  assert.equal(conflictingSession.isError, true);
  assert.deepEqual(conflictingSession.structuredContent?.validationErrors, [
    { field: "session_id", message: "Conflicting aliases for session_id" },
  ]);
});

test("per-call output limits are clamped and report truncation details", async () => {
  const { call } = createHarness();
  const result = await call("sequential_think", {
    topic: "A very long topic that creates a long JSON response",
    num_thoughts: 5,
    piMaxBytes: 120,
    piMaxLines: 2,
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent?.truncated, true);
  assert.deepEqual((result.structuredContent?.result as { omitted?: boolean }).omitted, true);
  assert.match(result.text, /Output truncated/);
});
