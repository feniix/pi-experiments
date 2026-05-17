import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SESSION_LABEL,
  generateUuid,
  normalizeSessionId,
  normalizeThoughtInput,
  parseThoughtStage,
  ThoughtStage,
  ThoughtValidationError,
  thoughtToDict,
  validateThoughtData,
} from "./types.js";

test("parses thought stages case-insensitively", () => {
  assert.equal(parseThoughtStage("Problem Definition"), ThoughtStage.PROBLEM_DEFINITION);
  assert.equal(parseThoughtStage("problem definition"), ThoughtStage.PROBLEM_DEFINITION);
  assert.equal(parseThoughtStage("RESEARCH"), ThoughtStage.RESEARCH);
  assert.equal(parseThoughtStage("analysis"), ThoughtStage.ANALYSIS);
  assert.throws(() => parseThoughtStage("Unknown"), /Invalid thinking stage/);
});

test("normalizes and validates session ids", () => {
  assert.deepEqual(normalizeSessionId(undefined), { sessionId: null, sessionLabel: DEFAULT_SESSION_LABEL });
  assert.deepEqual(normalizeSessionId("  architecture.review-1  "), {
    sessionId: "architecture.review-1",
    sessionLabel: "architecture.review-1",
  });

  for (const sessionId of ["", "   ", "bad/session", "bad\\session", "../bad", ".", "..", "default", "DEFAULT"]) {
    assert.throws(() => normalizeSessionId(sessionId), ThoughtValidationError);
  }
});

test("normalizes snake_case and camelCase thought input", () => {
  const snake = normalizeThoughtInput({
    thought: "Use snake case",
    thought_number: 1,
    total_thoughts: 3,
    next_thought_needed: true,
    stage: "Analysis",
    tags: ["compat"],
    axioms_used: ["Preserve old calls"],
    assumptions_challenged: ["Only camelCase matters"],
  });

  assert.deepEqual(snake.session, { sessionId: null, sessionLabel: DEFAULT_SESSION_LABEL });
  assert.deepEqual(snake.adjustments, {});
  assert.equal(snake.thought.stage, ThoughtStage.ANALYSIS);
  assert.deepEqual(snake.thought.axioms_used, ["Preserve old calls"]);

  const camel = normalizeThoughtInput({
    thought: "Use aliases",
    thoughtNumber: 2,
    totalThoughts: 4,
    nextThoughtNeeded: false,
    stage: "Synthesis",
    axiomsUsed: ["Boundary compatibility"],
    assumptionsChallenged: ["Schemas must stay snake-only"],
    sessionId: "review",
  });

  assert.equal(camel.thought.thought_number, 2);
  assert.equal(camel.thought.total_thoughts, 4);
  assert.equal(camel.thought.next_thought_needed, false);
  assert.equal(camel.thought.stage, ThoughtStage.SYNTHESIS);
  assert.deepEqual(camel.session, { sessionId: "review", sessionLabel: "review" });
});

test("reports conflicting aliases and adjusts total thoughts", () => {
  assert.throws(
    () =>
      normalizeThoughtInput({
        thought: "Conflict",
        thought_number: 1,
        thoughtNumber: 2,
        total_thoughts: 2,
        next_thought_needed: false,
        stage: "Analysis",
      }),
    /Conflicting aliases for thought_number/i,
  );

  const adjusted = normalizeThoughtInput({
    thought: "Need more steps",
    thought_number: 5,
    total_thoughts: 3,
    next_thought_needed: true,
    stage: "Analysis",
  });

  assert.equal(adjusted.thought.total_thoughts, 5);
  assert.deepEqual(adjusted.adjustments.totalThoughtsAdjusted, { from: 3, to: 5 });
});

test("returns field-specific validation errors", () => {
  assert.throws(
    () =>
      normalizeThoughtInput({
        thought: "   ",
        thought_number: 0,
        total_thoughts: 0,
        next_thought_needed: "nope",
        stage: "Unknown",
        tags: ["ok", 123],
      }),
    (error) => {
      assert.ok(error instanceof ThoughtValidationError);
      assert.deepEqual(
        error.errors.map((entry) => entry.field).sort(),
        ["next_thought_needed", "stage", "tags", "thought", "thought_number", "total_thoughts"].sort(),
      );
      return true;
    },
  );
});

test("serializes thoughts and validates partial thought data", () => {
  assert.deepEqual(
    validateThoughtData({
      thought: "My thought",
      thought_number: 5,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: ThoughtStage.ANALYSIS,
      tags: [],
      axioms_used: [],
      assumptions_challenged: [],
    }),
    [],
  );

  const dict = thoughtToDict({
    thought: "Test thought",
    thought_number: 1,
    total_thoughts: 3,
    next_thought_needed: true,
    stage: ThoughtStage.RESEARCH,
    tags: ["test"],
    axioms_used: [],
    assumptions_challenged: [],
    timestamp: "2024-01-01T00:00:00.000Z",
    id: "test-id",
  });

  assert.equal(dict.thoughtNumber, 1);
  assert.equal(dict.id, undefined);
  assert.match(generateUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
