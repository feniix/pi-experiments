import assert from "node:assert/strict";
import test from "node:test";
import { textTransformTool } from "../tools/text-transform.js";
import { executePortableTool } from "./execute-tool.js";

test("executePortableTool validates args before running a tool", async () => {
  const result = await executePortableTool(
    textTransformTool,
    { text: "Hello", operation: "not-real" },
    { host: "test" },
  );

  assert.equal(result.isError, true);
  assert.match(result.text, /Invalid arguments for text_transform/);
  assert.deepEqual(result.structuredContent?.tool, "text_transform");
  assert.ok(Array.isArray(result.structuredContent?.validationErrors));
});

test("executePortableTool runs valid tool args", async () => {
  const result = await executePortableTool(
    textTransformTool,
    { text: "Hello", operation: "reverse" },
    { host: "test" },
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.text, "olleH");
});
