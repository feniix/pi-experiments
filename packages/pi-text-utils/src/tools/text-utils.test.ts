import assert from "node:assert/strict";
import test from "node:test";
import { textStatsTool } from "./text-stats.js";
import { textTransformTool } from "./text-transform.js";

test("text_transform uppercases text and returns structured content", async () => {
  const result = await textTransformTool.execute(
    { text: "Hello pi", operation: "uppercase" },
    { host: "test" },
  );

  assert.equal(result.text, "HELLO PI");
  assert.deepEqual(result.structuredContent, {
    input: "Hello pi",
    output: "HELLO PI",
    operation: "uppercase",
    inputLength: 8,
    outputLength: 8,
  });
});

test("text_transform slugifies text", async () => {
  const result = await textTransformTool.execute(
    { text: " Héllo, Portable Tools! ", operation: "slugify" },
    { host: "test" },
  );

  assert.equal(result.text, "hello-portable-tools");
});

test("text_stats counts characters, words, and lines", async () => {
  const result = await textStatsTool.execute({ text: "one two\nthree" }, { host: "test" });

  assert.equal(result.text, JSON.stringify({ characters: 13, words: 3, lines: 2, isEmpty: false }, null, 2));
  assert.deepEqual(result.structuredContent, {
    characters: 13,
    words: 3,
    lines: 2,
    isEmpty: false,
  });
});

test("text_stats treats empty text as empty with zero words and lines", async () => {
  const result = await textStatsTool.execute({ text: "" }, { host: "test" });

  assert.deepEqual(result.structuredContent, {
    characters: 0,
    words: 0,
    lines: 0,
    isEmpty: true,
  });
});
