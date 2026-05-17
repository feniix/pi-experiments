import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpServer } from "@feniix/pi-portable-tools/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpSequentialThinkingTools } from "./mcp-server.js";

function textFromContent(content: unknown): string {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

function parseResult(result: unknown) {
  assert.equal(typeof result, "object");
  assert.notEqual(result, null);
  return JSON.parse(textFromContent((result as { content?: unknown }).content).replace(/\n\n\[Output truncated:[\s\S]*$/, ""));
}

test("MCP serves all sequential-thinking tools with source-compatible behavior", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-mcp-"));
  const exportPath = join(storageDir, "nested", "session.json");
  const legacyPath = join(storageDir, "legacy.json");
  const tools = createMcpSequentialThinkingTools({
    env: { MCP_STORAGE_DIR: storageDir, SEQ_THINK_MAX_BYTES: "51200", SEQ_THINK_MAX_LINES: "2000" },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ name: "pi-sequential-thinking-test", version: "0.1.0", tools });
  const client = new Client({ name: "pi-sequential-thinking-test-client", version: "0.1.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const list = await client.listTools();
    assert.deepEqual(
      list.tools.map((tool) => tool.name),
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

    const processResult = await client.callTool({
      name: "process_thought",
      arguments: {
        thought: "MCP thought",
        thoughtNumber: 2,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        stage: "analysis",
        sessionId: "research",
      },
    });
    assert.equal(processResult.isError, false);
    assert.equal(parseResult(processResult).receipt.totalThoughtsAdjusted.to, 2);

    const summary = parseResult(await client.callTool({ name: "generate_summary", arguments: { sessionId: "research" } }));
    assert.equal(summary.summary.totalThoughts, 1);

    const exportResult = parseResult(
      await client.callTool({ name: "export_session", arguments: { file_path: exportPath, sessionId: "research" } }),
    );
    assert.equal(exportResult.receipt.operation, "export_session");
    assert.equal(existsSync(exportPath), true);
    assert.equal(JSON.parse(readFileSync(exportPath, "utf-8")).sessionId, "research");

    const clear = parseResult(await client.callTool({ name: "clear_history", arguments: { sessionId: "research" } }));
    assert.equal(clear.receipt.postCount, 0);

    writeFileSync(
      legacyPath,
      JSON.stringify([
        {
          id: "legacy-id",
          thought: "Legacy MCP thought",
          thought_number: 4,
          total_thoughts: 4,
          next_thought_needed: false,
          stage: "Conclusion",
          timestamp: "2026-05-16T00:00:00.000Z",
        },
      ]),
      "utf-8",
    );
    const imported = parseResult(
      await client.callTool({ name: "import_session", arguments: { file_path: legacyPath, sessionId: "legacy-import" } }),
    );
    assert.equal(imported.receipt.postCount, 1);

    const history = parseResult(
      await client.callTool({ name: "get_thinking_history", arguments: { sessionId: "legacy-import", includeFullThoughts: false } }),
    );
    assert.equal(history.thoughts[0].thoughtNumber, 4);
    assert.equal(history.thoughts[0].thought, undefined);

    const sequential = parseResult(
      await client.callTool({ name: "sequential_think", arguments: { topic: "MCP strategy", sessionId: "scratch" } }),
    );
    assert.equal(sequential.receipt.postCount, 5);

    const status = parseResult(await client.callTool({ name: "get_thinking_status", arguments: {} }));
    assert.equal(status.effectiveConfig.sources.storageDir, "env");
    assert.equal(JSON.stringify(status).includes("MCP thought"), false);
    assert.equal(JSON.stringify(status).includes(storageDir), false);

    const invalid = await client.callTool({
      name: "process_thought",
      arguments: {
        thought: "   ",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Analysis",
      },
    });
    assert.equal(invalid.isError, true);
    assert.match(textFromContent(invalid.content), /Thought content cannot be empty/);
  } finally {
    await client.close();
    await server.close();
  }
});
