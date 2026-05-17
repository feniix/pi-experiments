import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@feniix/pi-portable-tools/mcp";
import { textUtilsTools } from "./tools/index.js";

test("text-utils tools are served through the extracted MCP adapter", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    name: "pi-text-utils-test",
    version: "0.3.0",
    tools: textUtilsTools,
    instructions: "Test text utils.",
  });
  const client = new Client({ name: "pi-text-utils-test", version: "0.1.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const list = await client.listTools();
    assert.deepEqual(
      list.tools.map((tool) => tool.name).sort(),
      ["text_stats", "text_transform"],
    );

    const result = await client.callTool({
      name: "text_transform",
      arguments: { text: "Hello MCP", operation: "slugify" },
    });
    assert.deepEqual(result.content, [{ type: "text", text: "hello-mcp" }]);
    assert.deepEqual(result.structuredContent, {
      input: "Hello MCP",
      output: "hello-mcp",
      operation: "slugify",
      inputLength: 9,
      outputLength: 9,
    });
    assert.equal(result.isError, false);

    const invalid = await client.callTool({
      name: "text_transform",
      arguments: { text: "Hello MCP", operation: "unknown" },
    });
    assert.equal(invalid.isError, true);
    assert.ok(Array.isArray(invalid.content));
    assert.equal(invalid.content[0]?.type, "text");
    assert.match(invalid.content[0].text, /Invalid arguments/);

    const unknown = await client.callTool({ name: "missing_tool", arguments: {} });
    assert.equal(unknown.isError, true);
    assert.ok(Array.isArray(unknown.content));
    assert.equal(unknown.content[0]?.type, "text");
    assert.match(unknown.content[0].text, /Unknown tool: missing_tool/);
  } finally {
    await client.close();
    await server.close();
  }
});
