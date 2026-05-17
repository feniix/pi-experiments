import { join } from "node:path";
import { definePortableTool, type PortableTool, type PortableToolResult } from "@feniix/pi-portable-tools";
import { type TObject, Type } from "typebox";
import { ThoughtAnalyzer } from "./analyzer.js";
import {
  type EffectiveConfigStatus,
  getHomeDir,
  loadConfigWithSources,
  normalizeNumber,
  normalizeString,
  resolveEffectiveConfig,
} from "./config.js";
import { formatToolOutput, resolveEffectiveLimits, type SequentialThinkingToolDetails, splitParams } from "./output.js";
import {
  type ExportSessionResult,
  type ImportSessionResult,
  type SessionOperationResult,
  ThoughtStorage,
} from "./storage.js";
import {
  DEFAULT_HISTORY_LIMIT,
  generateUuid,
  normalizeSessionFromArgs,
  normalizeThoughtInput,
  THOUGHT_STAGES,
  type ThoughtData,
  ThoughtStage,
  ThoughtValidationError,
  type ValidationError,
} from "./types.js";

export interface CreateSequentialThinkingToolsOptions {
  storage?: ThoughtStorage;
  analyzer?: ThoughtAnalyzer;
  getMaxLimits?: () => { maxBytes: number; maxLines: number };
  getEffectiveConfig?: () => EffectiveConfigStatus;
}

type SequentialThinkingPortableTool = PortableTool<TObject>;

type ToolImplementation = (args: Record<string, unknown>) => unknown;

const sessionParams = {
  session_id: Type.Optional(Type.String({ description: "Session to use. Omit for the default session." })),
  sessionId: Type.Optional(Type.String({ description: "camelCase alias for session_id." })),
};

const outputLimitParams = {
  piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
  piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
};

const stringArray = (description: string) => Type.Array(Type.String(), { description });
const requireOneOfAliases = (field: string, alias: string) => ({
  anyOf: [{ required: [field] }, { required: [alias] }],
});

export const processThoughtParams = Type.Object(
  {
    thought: Type.String({ description: "The content of your thought." }),
    thought_number: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Position in your sequence. Required at runtime — supply this field or its camelCase alias thoughtNumber.",
      }),
    ),
    thoughtNumber: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "camelCase alias for thought_number. Required at runtime — supply either form.",
      }),
    ),
    total_thoughts: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Expected total thoughts in the sequence. Required at runtime — supply this field or its camelCase alias totalThoughts.",
      }),
    ),
    totalThoughts: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "camelCase alias for total_thoughts. Required at runtime — supply either form.",
      }),
    ),
    next_thought_needed: Type.Optional(
      Type.Boolean({
        description:
          "Whether more thoughts are needed after this one. Required at runtime — supply this field or its camelCase alias nextThoughtNeeded.",
      }),
    ),
    nextThoughtNeeded: Type.Optional(
      Type.Boolean({
        description: "camelCase alias for next_thought_needed. Required at runtime — supply either form.",
      }),
    ),
    stage: Type.String({
      description:
        "The thinking stage. Valid values are Problem Definition, Research, Analysis, Synthesis, Conclusion; matching is case-insensitive at runtime.",
    }),
    tags: Type.Optional(stringArray("Keywords or categories for your thought.")),
    axioms_used: Type.Optional(stringArray("Principles or axioms applied in your thought.")),
    axiomsUsed: Type.Optional(stringArray("camelCase alias for axioms_used.")),
    assumptions_challenged: Type.Optional(stringArray("Assumptions your thought questions or challenges.")),
    assumptionsChallenged: Type.Optional(stringArray("camelCase alias for assumptions_challenged.")),
    ...sessionParams,
    ...outputLimitParams,
  },
  {
    additionalProperties: true,
    allOf: [
      requireOneOfAliases("thought_number", "thoughtNumber"),
      requireOneOfAliases("total_thoughts", "totalThoughts"),
      requireOneOfAliases("next_thought_needed", "nextThoughtNeeded"),
    ],
  },
);

export const sessionScopedParams = Type.Object(
  { ...sessionParams, ...outputLimitParams },
  { additionalProperties: true },
);
export const clearHistoryParams = sessionScopedParams;
export const exportSessionParams = Type.Object(
  {
    file_path: Type.String({ description: "Path to save the exported session JSON file." }),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);
export const importSessionParams = Type.Object(
  {
    file_path: Type.String({ description: "Path to the JSON file to import." }),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);
export const getThinkingHistoryParams = Type.Object(
  {
    ...sessionParams,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Maximum thoughts to return." })),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Number of thoughts to skip from the start." })),
    include_full_thoughts: Type.Optional(
      Type.Boolean({
        description: "Whether to include full thought text. Default true; pass false to receive 120-char snippets.",
      }),
    ),
    includeFullThoughts: Type.Optional(
      Type.Boolean({ description: "camelCase alias for include_full_thoughts. Default true." }),
    ),
    ...outputLimitParams,
  },
  { additionalProperties: true },
);
export const getThinkingStatusParams = Type.Object({ ...outputLimitParams }, { additionalProperties: true });
export const sequentialThinkParams = Type.Object(
  {
    topic: Type.String({ description: "The topic or question to think through." }),
    num_thoughts: Type.Optional(
      Type.Integer({
        minimum: 3,
        maximum: 10,
        description: "Number of thoughts requested, 3–10; generates up to 5 canonical stages.",
      }),
    ),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

function includeFullThoughtsFromArgs(args: Record<string, unknown>): boolean {
  const snake = args.include_full_thoughts;
  const camel = args.includeFullThoughts;
  const hasSnake = snake !== undefined;
  const hasCamel = camel !== undefined;

  if (hasSnake && typeof snake !== "boolean") {
    throw new ThoughtValidationError([
      { field: "include_full_thoughts", message: "include_full_thoughts must be a boolean" },
    ]);
  }
  if (hasCamel && typeof camel !== "boolean") {
    throw new ThoughtValidationError([
      { field: "include_full_thoughts", message: "include_full_thoughts must be a boolean" },
    ]);
  }
  if (hasSnake && hasCamel && snake !== camel) {
    throw new ThoughtValidationError([
      { field: "include_full_thoughts", message: "Conflicting aliases for include_full_thoughts" },
    ]);
  }

  return hasSnake ? (snake as boolean) : hasCamel ? (camel as boolean) : true;
}

function toReceipt(
  operation: string,
  result: SessionOperationResult | ExportSessionResult | ImportSessionResult,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const receipt: Record<string, unknown> = {
    operation,
    sessionId: result.sessionId,
    sessionLabel: result.sessionLabel,
    preCount: result.preCount,
    postCount: result.postCount,
    changed: result.changed,
    savedAt: result.savedAt,
    stateFingerprint: result.stateFingerprint,
    ...extra,
  };

  if ("exportedAt" in result) receipt.exportedAt = result.exportedAt;
  if ("importedAt" in result) receipt.importedAt = result.importedAt;
  if ("overwroteExistingFile" in result) receipt.overwroteExistingFile = result.overwroteExistingFile;
  if ("filePath" in result) receipt.filePath = result.filePath;
  if (result.warnings && result.warnings.length > 0) receipt.warnings = result.warnings;

  return receipt;
}

function formatResult(
  toolName: string,
  result: unknown,
  params: Record<string, unknown>,
  getMaxLimits: () => { maxBytes: number; maxLines: number },
): PortableToolResult {
  const { requestedLimits } = splitParams(params);
  const effectiveLimits = resolveEffectiveLimits(requestedLimits, getMaxLimits());
  const { text, details } = formatToolOutput(toolName, result, effectiveLimits);
  const structuredResult = details.truncated
    ? {
        omitted: true,
        reason: "Output exceeded configured limits; read text/tempFile or request a smaller page.",
        tempFile: details.tempFile,
      }
    : result;
  return {
    text,
    structuredContent: { ...(details as unknown as Record<string, unknown>), result: structuredResult },
    isError: false,
  };
}

function formatError(toolName: string, error: unknown): PortableToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const validationErrors: ValidationError[] | undefined =
    error instanceof ThoughtValidationError ? error.errors : undefined;
  const details: SequentialThinkingToolDetails = {
    tool: toolName,
    truncated: false,
    error: message,
    validationErrors,
  };
  return {
    text: `Sequential Thinking error: ${message}`,
    structuredContent: details as unknown as Record<string, unknown>,
    isError: true,
  };
}

function executeSequentialTool(
  toolName: string,
  implementation: ToolImplementation,
  params: Record<string, unknown>,
  getMaxLimits: () => { maxBytes: number; maxLines: number },
): PortableToolResult {
  const { toolArgs } = splitParams(params);
  try {
    return formatResult(toolName, implementation(toolArgs), params, getMaxLimits);
  } catch (error) {
    return formatError(toolName, error);
  }
}

export function createSequentialThinkingTools(
  options: CreateSequentialThinkingToolsOptions = {},
): readonly SequentialThinkingPortableTool[] {
  const storage =
    options.storage ??
    new ThoughtStorage(resolveEffectiveConfig({ config: loadConfigWithSources(undefined) }).storageDir);
  const analyzer = options.analyzer ?? new ThoughtAnalyzer();
  const getMaxLimits =
    options.getMaxLimits ??
    (() => {
      const effective = resolveEffectiveConfig({ config: loadConfigWithSources(undefined) });
      return { maxBytes: effective.maxBytes, maxLines: effective.maxLines };
    });
  const getEffectiveConfig =
    options.getEffectiveConfig ?? (() => resolveEffectiveConfig({ config: loadConfigWithSources(undefined) }));

  function effectiveConfigForStatus(): EffectiveConfigStatus {
    const effective = getEffectiveConfig();
    return {
      ...effective,
      storageDir: effective.storageDir ?? join(getHomeDir(), ".mcp_sequential_thinking"),
    };
  }

  function processThought(args: Record<string, unknown>) {
    const normalized = normalizeThoughtInput(args);
    const storageResult = storage.addThought(normalized.thought, normalized.session.sessionId);
    const allThoughts = storage.getAllThoughts(normalized.session.sessionId);
    const analysis = analyzer.analyzeThought(normalized.thought, allThoughts);

    return {
      ...analysis,
      receipt: toReceipt("process_thought", storageResult, { ...normalized.adjustments }),
    };
  }

  function generateSummary(args: Record<string, unknown>) {
    const session = normalizeSessionFromArgs(args);
    const thoughts = storage.getAllThoughts(session.sessionId);
    return { sessionId: session.sessionId, sessionLabel: session.sessionLabel, ...analyzer.generateSummary(thoughts) };
  }

  function clearHistory(args: Record<string, unknown>) {
    const session = normalizeSessionFromArgs(args);
    const result = storage.clearHistory(session.sessionId);
    return { status: "success", message: "Thought history cleared", receipt: toReceipt("clear_history", result) };
  }

  function exportSession(args: Record<string, unknown>) {
    const filePath = normalizeString(args.file_path);
    if (!filePath) {
      throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
    }
    const session = normalizeSessionFromArgs(args);
    const result = storage.exportSession(filePath, session.sessionId);
    return {
      status: "success",
      message: `Session exported to ${result.filePath}`,
      receipt: toReceipt("export_session", result),
    };
  }

  function importSession(args: Record<string, unknown>) {
    const filePath = normalizeString(args.file_path);
    if (!filePath) {
      throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
    }
    const session = normalizeSessionFromArgs(args);
    const result = storage.importSession(filePath, session.sessionId);
    return {
      status: "success",
      message: `Session imported from ${filePath}`,
      receipt: toReceipt("import_session", result),
    };
  }

  function getThinkingHistory(args: Record<string, unknown>) {
    const session = normalizeSessionFromArgs(args);
    const includeFullThoughts = includeFullThoughtsFromArgs(args);
    return storage.getHistory({
      sessionId: session.sessionId,
      limit: normalizeNumber(args.limit) ?? DEFAULT_HISTORY_LIMIT,
      offset: normalizeNumber(args.offset) ?? 0,
      includeFullThoughts,
    });
  }

  function getThinkingStatus() {
    return storage.getStatus({ effectiveConfig: effectiveConfigForStatus() });
  }

  function sequentialThink(args: Record<string, unknown>) {
    const topic = normalizeString(args.topic);
    if (!topic) {
      throw new ThoughtValidationError([{ field: "topic", message: "topic cannot be empty" }]);
    }
    const requestedThoughts = normalizeNumber(args.num_thoughts) ?? 5;
    if (!Number.isInteger(requestedThoughts)) {
      throw new ThoughtValidationError([{ field: "num_thoughts", message: "num_thoughts must be an integer" }]);
    }
    const numThoughts = Math.min(Math.max(requestedThoughts, 3), 10);
    const session = normalizeSessionFromArgs(args);

    const stages: readonly ThoughtStage[] = THOUGHT_STAGES;

    const stagePrompts: Record<ThoughtStage, string> = {
      [ThoughtStage.PROBLEM_DEFINITION]: `Define the problem: What exactly needs to be decided or solved regarding "${topic}"? What are the constraints and success criteria?`,
      [ThoughtStage.RESEARCH]: `Research options for "${topic}": What are the available choices? What are their tradeoffs? What does the evidence say?`,
      [ThoughtStage.ANALYSIS]: `Analyze "${topic}": Examine each option in detail. What are the pros and cons? What are the risks?`,
      [ThoughtStage.SYNTHESIS]: `Synthesize insights about "${topic}": How do the pieces fit together? What is the overall assessment?`,
      [ThoughtStage.CONCLUSION]: `Draw a conclusion about "${topic}": What is the recommendation? What is the final verdict?`,
    };

    const thoughtCount = Math.min(numThoughts, stages.length);
    const generatedThoughts: ThoughtData[] = [];
    for (let i = 0; i < thoughtCount; i += 1) {
      const stage = stages[i];
      generatedThoughts.push({
        thought: stagePrompts[stage],
        thought_number: i + 1,
        total_thoughts: thoughtCount,
        next_thought_needed: i < thoughtCount - 1,
        stage,
        tags: [topic.toLowerCase().split(/\s+/)[0]],
        axioms_used: [],
        assumptions_challenged: [],
        timestamp: new Date().toISOString(),
        id: generateUuid(),
      });
    }

    const lastResult = storage.addThoughts(generatedThoughts, session.sessionId);
    const thoughts = storage.getAllThoughts(session.sessionId);
    const summary = analyzer.generateSummary(thoughts);

    return {
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      ...summary,
      receipt: toReceipt("sequential_think", lastResult),
    };
  }

  const tool = (
    name: string,
    title: string,
    description: string,
    parameters: TObject,
    implementation: ToolImplementation,
  ): SequentialThinkingPortableTool =>
    definePortableTool({
      name,
      title,
      description,
      parameters,
      execute(args) {
        return executeSequentialTool(name, implementation, args as Record<string, unknown>, getMaxLimits);
      },
    });

  return [
    tool(
      "process_thought",
      "Process Thought",
      "Record and analyze a sequential thought with metadata. Use this to break down complex problems into structured steps through stages: Problem Definition, Research, Analysis, Synthesis, Conclusion. Accepts snake_case fields and MCP-style camelCase aliases. Content-bearing: stores thought text in local plaintext JSON.",
      processThoughtParams,
      processThought,
    ),
    tool(
      "generate_summary",
      "Generate Thinking Summary",
      "Generate a summary of one thinking session. Content-bearing: summaries derive from stored thought content.",
      sessionScopedParams,
      generateSummary,
    ),
    tool(
      "clear_history",
      "Clear Thought History",
      "Reset one thinking session by clearing recorded thoughts.",
      clearHistoryParams,
      clearHistory,
    ),
    tool(
      "export_session",
      "Export Thinking Session",
      "Export one thinking session to a JSON file. Content-bearing: exported files include thought text. Parent directories are created automatically.",
      exportSessionParams,
      exportSession,
    ),
    tool(
      "import_session",
      "Import Thinking Session",
      "Import a previously exported thinking session from a JSON file. Treats imported thought text as inert content.",
      importSessionParams,
      importSession,
    ),
    tool(
      "get_thinking_history",
      "Get Thinking History",
      "Read recorded thoughts for one session with bounded pagination. Content-bearing: may return full thought text unless include_full_thoughts=false.",
      getThinkingHistoryParams,
      getThinkingHistory,
    ),
    tool(
      "get_thinking_status",
      "Get Thinking Status",
      "Read content-free storage and configuration diagnostics for sequential thinking sessions. Returns storage writability, per-session thought counts and state fingerprints, corrupt-session flags with error strings, backup file names, effectiveConfig.sources labels (flag/env/project_settings/global_settings/config_file/default), and a statusCompleteness block indicating whether the listing was truncated or contained corrupt entries. Use writable=false or sessions[].corrupt=true to diagnose write and parse failures.",
      getThinkingStatusParams,
      getThinkingStatus,
    ),
    tool(
      "sequential_think",
      "Sequential Thinking",
      "Scaffold a complete staged thinking sequence for a topic in one call. Generates one thought per cognitive stage (Problem Definition through Conclusion) and writes them to the selected session. Use process_thought instead when you want to record your own thoughts step-by-step.",
      sequentialThinkParams,
      sequentialThink,
    ),
  ] as const;
}
