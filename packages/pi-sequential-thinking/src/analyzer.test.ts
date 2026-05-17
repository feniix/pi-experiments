import assert from "node:assert/strict";
import test from "node:test";
import { ThoughtAnalyzer } from "./analyzer.js";
import { type ThoughtData, ThoughtStage } from "./types.js";

function createThought(overrides: Partial<ThoughtData> = {}): ThoughtData {
  return {
    thought: "Test thought",
    thought_number: 1,
    total_thoughts: 5,
    next_thought_needed: true,
    stage: ThoughtStage.ANALYSIS,
    tags: [],
    axioms_used: [],
    assumptions_challenged: [],
    timestamp: "2024-01-01T00:00:00.000Z",
    id: "default-id",
    ...overrides,
  };
}

test("finds related thoughts by same stage before tags", () => {
  const analyzer = new ThoughtAnalyzer();
  const current = createThought({ id: "current", stage: ThoughtStage.RESEARCH, tags: ["tag1"] });
  const sameStage = createThought({ id: "same-stage", stage: ThoughtStage.RESEARCH });
  const tagMatch = createThought({ id: "tag-match", stage: ThoughtStage.ANALYSIS, tags: ["tag1"] });

  const result = analyzer.findRelatedThoughts(current, [current, sameStage, tagMatch], 1);
  assert.equal(result[0].id, "same-stage");
});

test("finds tag related thoughts by matching tag count", () => {
  const analyzer = new ThoughtAnalyzer();
  const current = createThought({ id: "current", stage: ThoughtStage.RESEARCH, tags: ["database", "performance"] });
  const match1 = createThought({ id: "match1", stage: ThoughtStage.ANALYSIS, tags: ["database"] });
  const match2 = createThought({
    id: "match2",
    stage: ThoughtStage.SYNTHESIS,
    tags: ["database", "performance"],
  });

  const result = analyzer.findRelatedThoughts(current, [current, match1, match2], 2);
  assert.deepEqual(
    result.map((thought) => thought.id),
    ["match2", "match1"],
  );
});

test("analyzes thought progress and first-in-stage state", () => {
  const analyzer = new ThoughtAnalyzer();
  const thought = createThought({
    id: "thought1",
    thought_number: 2,
    total_thoughts: 5,
    stage: ThoughtStage.SYNTHESIS,
    tags: ["architecture"],
  });

  const result = analyzer.analyzeThought(thought, [
    createThought({ id: "prev", thought_number: 1, stage: ThoughtStage.SYNTHESIS }),
    thought,
  ]);

  assert.equal(result.thoughtAnalysis.currentThought.thoughtNumber, 2);
  assert.equal(result.thoughtAnalysis.analysis.progress, 40);
  assert.equal(result.thoughtAnalysis.analysis.isFirstInStage, false);
});

test("generates empty and populated summaries", () => {
  const analyzer = new ThoughtAnalyzer();
  assert.equal(analyzer.generateSummary([]).summary, "No thoughts recorded yet");

  const thoughts = [
    createThought({ id: "1", thought_number: 1, stage: ThoughtStage.PROBLEM_DEFINITION, tags: ["tag1", "tag2"] }),
    createThought({ id: "2", thought_number: 2, stage: ThoughtStage.RESEARCH, tags: ["tag1"] }),
    createThought({ id: "3", thought_number: 3, stage: ThoughtStage.ANALYSIS, total_thoughts: 3 }),
  ];
  const summary = analyzer.generateSummary(thoughts).summary;
  assert.notEqual(typeof summary, "string");
  if (typeof summary === "string") throw new Error("expected structured summary");

  assert.equal(summary.totalThoughts, 3);
  assert.equal(summary.stages[ThoughtStage.RESEARCH], 1);
  assert.deepEqual(summary.timeline, [
    { number: 1, stage: ThoughtStage.PROBLEM_DEFINITION },
    { number: 2, stage: ThoughtStage.RESEARCH },
    { number: 3, stage: ThoughtStage.ANALYSIS },
  ]);
  assert.deepEqual(summary.topTags[0], { tag: "tag1", count: 2 });
});
