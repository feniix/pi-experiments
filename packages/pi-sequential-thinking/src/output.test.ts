import assert from "node:assert/strict";
import { existsSync, statSync, unlinkSync } from "node:fs";
import test from "node:test";
import { formatToolOutput, resolveEffectiveLimits, splitParams, toJsonString, writeTempFile } from "./output.js";

test("stringifies output values", () => {
  assert.equal(toJsonString("hello"), "hello");
  assert.equal(toJsonString(42), "42");
  assert.deepEqual(JSON.parse(toJsonString({ a: 1, b: 2 })), { a: 1, b: 2 });
});

test("splits params and clamps output limits", () => {
  const { toolArgs, requestedLimits } = splitParams({
    piMaxBytes: "100",
    piMaxLines: 5,
    thought: "hello",
  });

  assert.deepEqual(toolArgs, { thought: "hello" });
  assert.deepEqual(requestedLimits, { maxBytes: 100, maxLines: 5 });
  assert.deepEqual(resolveEffectiveLimits({ maxBytes: 200, maxLines: 2 }, { maxBytes: 120, maxLines: 10 }), {
    maxBytes: 120,
    maxLines: 2,
  });
});

test("formats simple and truncated tool output", () => {
  const simple = formatToolOutput("test_tool", { message: "Hello" }, { maxBytes: 50000, maxLines: 2000 });
  assert.match(simple.text, /Hello/);
  assert.equal(simple.details.truncated, false);

  const truncated = formatToolOutput("test_tool", { lines: ["one", "two", "three"] }, { maxBytes: 30, maxLines: 1 });
  assert.equal(truncated.details.truncated, true);
  assert.match(truncated.text, /Output truncated/);
  assert.equal(typeof truncated.details.tempFile, "string");
  if (typeof truncated.details.tempFile === "string") unlinkSync(truncated.details.tempFile);
});

test("writes temp files with sanitized names and caps oversized overflow", () => {
  const path = writeTempFile("my-tool!@#", "content");
  assert.ok(path);
  assert.match(path, /my-tool__/);
  assert.equal(existsSync(path), true);
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o077, 0);
  }
  unlinkSync(path);

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal(writeTempFile("huge", "x".repeat(10 * 1024 * 1024 + 1)), undefined);
  } finally {
    console.warn = originalWarn;
  }
});
