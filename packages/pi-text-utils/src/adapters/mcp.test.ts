import assert from "node:assert/strict";
import test from "node:test";
import { textUtilsTools } from "../tools/index.js";
import { createMcpServer, getPackageVersion, registerMcpTools } from "./mcp.js";

test("registerMcpTools registers every portable tool with MCP metadata", () => {
  const registered: Array<{ name: string; config: Record<string, unknown>; callback: Function }> = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>, callback: Function) {
      registered.push({ name, config, callback });
    },
  };

  registerMcpTools(server, textUtilsTools);

  assert.deepEqual(
    registered.map(({ name, config }) => ({
      name,
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
    })),
    textUtilsTools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  );
});

test("registered MCP tool delegates execution to the portable tool", async () => {
  const registered: Array<{ name: string; callback: Function }> = [];
  const server = {
    registerTool(name: string, _config: Record<string, unknown>, callback: Function) {
      registered.push({ name, callback });
    },
  };

  registerMcpTools(server, textUtilsTools);
  const transform = registered.find((tool) => tool.name === "text_transform");
  assert.ok(transform);

  const result = await transform.callback({ text: "Hello", operation: "lowercase" }, { signal: undefined });

  assert.deepEqual(result, {
    content: [{ type: "text", text: "hello" }],
    structuredContent: {
      input: "Hello",
      output: "hello",
      operation: "lowercase",
      inputLength: 5,
      outputLength: 5,
    },
    isError: false,
  });
});

test("createMcpServer returns a connectable MCP server", () => {
  const server = createMcpServer(textUtilsTools);

  assert.equal(typeof server.connect, "function");
});

test("getPackageVersion reads the package version from package metadata", () => {
  assert.equal(getPackageVersion(), "0.2.0");
});
