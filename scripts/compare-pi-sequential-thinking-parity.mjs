#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(repoRoot, "packages/pi-sequential-thinking/dist/src/mcp-server.js");
const extensionPath = join(repoRoot, "packages/pi-sequential-thinking/dist/extensions/index.js");
const toolsPath = join(repoRoot, "packages/pi-sequential-thinking/dist/src/tools.js");
const DEFAULT_TIMEOUT_MS = 30_000;
const TOOL_NAMES = [
  "process_thought",
  "generate_summary",
  "clear_history",
  "export_session",
  "import_session",
  "get_thinking_history",
  "get_thinking_status",
  "sequential_think",
];
const PI_FLAG_NAMES = [
  "--seq-think-storage-dir",
  "--seq-think-config-file",
  "--seq-think-config",
  "--seq-think-max-bytes",
  "--seq-think-max-lines",
];
const EXPECTED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    tool: { type: "string" },
    truncated: { type: "boolean" },
    truncation: { type: "object", additionalProperties: true },
    tempFile: { type: "string" },
    result: { type: "object", additionalProperties: true },
    error: { type: "string" },
    validationErrors: { type: "array", items: { type: "object", additionalProperties: true } },
  },
  required: ["tool", "truncated"],
  additionalProperties: true,
};

const ALWAYS_VOLATILE_KEYS = new Set(["savedAt", "exportedAt", "importedAt", "stateFingerprint", "lastUpdated"]);
const PATH_VALUE_KEYS = new Set(["defaultSessionFile", "filePath", "storageDir", "tempFile"]);
const PATH_MESSAGE_KEYS = new Set(["error", "message"]);
const MEASUREMENT_KEYS = new Set(["totalBytes", "outputBytes", "totalLines", "outputLines"]);
const SEQUENTIAL_THINKING_ENV_KEYS = [
  "MCP_STORAGE_DIR",
  "SEQ_THINK_CONFIG",
  "SEQ_THINK_CONFIG_FILE",
  "SEQ_THINK_MAX_BYTES",
  "SEQ_THINK_MAX_LINES",
];
const overflowTempFiles = new Set();
const SHOW_FULL_MCP_SCHEMA = process.env.PARITY_SHOW_MCP_SCHEMA === "1";

/** @typedef {{ isError: boolean, textPayload: unknown, structuredPayload: unknown }} ComparableResult */
/** @typedef {{ name: string, storageDir: string, exportPath: string, legacyPath: string, listTools: () => Promise<Array<Record<string, unknown>>>, toolSchemasForLlm?: () => Promise<Array<Record<string, unknown>>>, callTool: (name: string, args?: Record<string, unknown>) => Promise<ComparableResult>, close: () => Promise<void>, stderr?: string }} HostRunner */

function withTimeout(promise, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function textFromContent(content) {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content.length, 1, "tool result content must contain exactly one item");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

function parseMaybeJson(text) {
  const cleaned = text.replace(/\n\n\[Output truncated:[\s\S]*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return cleaned;
  }
}

function normalizePathString(value, context) {
  let output = value;
  for (const path of context.paths) {
    output = output.split(path).join("<path>");
    output = output.split(`<absolute:${basename(path)}>`).join("<path>");
  }
  return output;
}

function includesPathSegment(path, segment) {
  return path.some((part) => part === segment);
}

function shouldDropVolatileField(path, key, entry) {
  if (entry === undefined) return true;
  if (ALWAYS_VOLATILE_KEYS.has(key)) return true;
  if (key === "id" && includesPathSegment(path, "thoughts")) return true;
  if (key === "timestamp" && (includesPathSegment(path, "thoughts") || includesPathSegment(path, "currentThought"))) {
    return true;
  }
  return false;
}

function shouldNormalizeString(path) {
  const key = path.at(-1);
  if (path.length === 1 && key === "textPayload") return true;
  return PATH_VALUE_KEYS.has(String(key)) || PATH_MESSAGE_KEYS.has(String(key));
}

function normalizeValue(value, context, path = []) {
  if (typeof value === "string") return shouldNormalizeString(path) ? normalizePathString(value, context) : value;
  if (Array.isArray(value)) return value.map((item, index) => normalizeValue(item, context, [...path, index]));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => !shouldDropVolatileField(path, key, entry))
      .map(([key, entry]) => {
        const nextPath = [...path, key];
        if (key === "truncation" && entry && typeof entry === "object") {
          return [
            key,
            Object.fromEntries(
              Object.entries(entry).map(([truncationKey, truncationValue]) => [
                truncationKey,
                MEASUREMENT_KEYS.has(truncationKey)
                  ? "<measurement>"
                  : normalizeValue(truncationValue, context, [...nextPath, truncationKey]),
              ]),
            ),
          ];
        }
        if (key === "tempFile") return [key, typeof entry === "string" ? "<temp-file-present>" : entry];
        return [key, normalizeValue(entry, context, nextPath)];
      }),
  );
}

function normalizeComparableResult(result, context) {
  return {
    isError: result.isError,
    textPayload: normalizeValue(result.textPayload, context, ["textPayload"]),
    structuredPayload: normalizeValue(result.structuredPayload, context, ["structuredPayload"]),
  };
}

function assertNormalizedEqual(label, left, leftContext, right, rightContext) {
  const normalizedLeft = normalizeComparableResult(left, leftContext);
  const normalizedRight = normalizeComparableResult(right, rightContext);
  assert.deepEqual(normalizedLeft, normalizedRight, label);
  return normalizedLeft;
}

function preview(value, maxLength = 360) {
  const compact = JSON.stringify(value).replaceAll("\\n", " ");
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function structuredPreview(value) {
  if (!value || typeof value !== "object") return preview(value, 240);
  return preview(
    {
      tool: value.tool,
      truncated: value.truncated,
      resultKeys: value.result && typeof value.result === "object" ? Object.keys(value.result) : undefined,
      error: value.error,
      validationErrors: value.validationErrors,
    },
    240,
  );
}

function runNormalizationSelfChecks() {
  const leftContext = { paths: ["/tmp/pi-seq-parity-left", "<absolute:pi-seq-parity-left>"] };
  const rightContext = { paths: ["/tmp/pi-seq-parity-right", "<absolute:pi-seq-parity-right>"] };
  const left = {
    isError: false,
    textPayload: {
      filePath: "/tmp/pi-seq-parity-left/export.json",
      thoughts: [{ id: "left-generated-id", timestamp: "2026-05-17T00:00:00.000Z", thought: "same" }],
      receipt: { operation: "process_thought", savedAt: "left", stateFingerprint: "left-fingerprint" },
    },
    structuredPayload: {
      tool: "process_thought",
      truncated: false,
      result: { storageDir: "<absolute:pi-seq-parity-left>" },
    },
  };
  const right = {
    isError: false,
    textPayload: {
      filePath: "/tmp/pi-seq-parity-right/export.json",
      thoughts: [{ id: "right-generated-id", timestamp: "2026-05-17T00:00:01.000Z", thought: "same" }],
      receipt: { operation: "process_thought", savedAt: "right", stateFingerprint: "right-fingerprint" },
    },
    structuredPayload: {
      tool: "process_thought",
      truncated: false,
      result: { storageDir: "<absolute:pi-seq-parity-right>" },
    },
  };
  assertNormalizedEqual("normalization should ignore volatile fields", left, leftContext, right, rightContext);

  const semanticDrift = structuredClone(right);
  semanticDrift.textPayload.receipt.operation = "clear_history";
  assert.throws(
    () =>
      assertNormalizedEqual(
        "normalization must preserve semantic drift",
        left,
        leftContext,
        semanticDrift,
        rightContext,
      ),
    assert.AssertionError,
  );

  const stableIdentifierDrift = structuredClone(right);
  stableIdentifierDrift.textPayload.metadata = { id: "stable-right" };
  const stableIdentifierLeft = structuredClone(left);
  stableIdentifierLeft.textPayload.metadata = { id: "stable-left" };
  assert.throws(
    () =>
      assertNormalizedEqual(
        "normalization must preserve stable identifier drift",
        stableIdentifierLeft,
        leftContext,
        stableIdentifierDrift,
        rightContext,
      ),
    assert.AssertionError,
  );
}

function normalizeMcpResult(result) {
  return {
    isError: result.isError ?? false,
    textPayload: parseMaybeJson(textFromContent(result.content)),
    structuredPayload: result.structuredContent ?? {},
  };
}

function normalizePiResult(result) {
  return {
    isError: result.isError ?? false,
    textPayload: parseMaybeJson(textFromContent(result.content)),
    structuredPayload: result.details ?? {},
  };
}

function createMockPi(flags = {}) {
  const registeredFlags = [];
  const tools = [];
  return {
    registeredFlags,
    tools,
    registerFlag(name) {
      registeredFlags.push(name);
    },
    getFlag(name) {
      return flags[name];
    },
    registerTool(tool) {
      tools.push(tool);
    },
    on() {
      return undefined;
    },
  };
}

function createHostEnv(tempRoot, hostName, storageDir) {
  const env = { ...process.env };
  for (const key of SEQUENTIAL_THINKING_ENV_KEYS) {
    delete env[key];
  }
  env.HOME = join(tempRoot, `${hostName}-home`);
  env.MCP_STORAGE_DIR = storageDir;
  env.SEQ_THINK_MAX_BYTES = "51200";
  env.SEQ_THINK_MAX_LINES = "2000";
  mkdirSync(env.HOME, { recursive: true });
  return env;
}

async function withProcessEnv(env, operation) {
  const patchKeys = new Set(["HOME", ...SEQUENTIAL_THINKING_ENV_KEYS]);
  const previous = new Map([...patchKeys].map((key) => [key, process.env[key]]));
  for (const key of patchKeys) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** @returns {Promise<HostRunner>} */
async function createMcpHost(tempRoot) {
  const storageDir = join(tempRoot, "mcp-storage");
  mkdirSync(storageDir, { recursive: true });
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repoRoot,
    env: createHostEnv(tempRoot, "mcp", storageDir),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "pi-sequential-thinking-parity-mcp", version: "0.1.0" });
  let listedTools;
  async function toolSchemasForLlm() {
    if (!listedTools) {
      listedTools = (await withTimeout(client.listTools(), "MCP listTools")).tools;
    }
    return listedTools;
  }
  try {
    await withTimeout(client.connect(transport), "MCP client connect");
  } catch (error) {
    const closeErrors = [];
    try {
      await withTimeout(client.close(), "MCP client close after failed connect", 5_000);
    } catch (closeError) {
      closeErrors.push(closeError);
    }
    const message = error instanceof Error ? error.message : String(error);
    const closeMessage = closeErrors.length > 0 ? `\nClose failure: ${closeErrors.map(String).join("; ")}` : "";
    throw new Error(
      stderr.trim() ? `${message}${closeMessage}\nMCP server stderr:\n${stderr.trim()}` : `${message}${closeMessage}`,
      {
        cause: error,
      },
    );
  }

  return {
    name: "mcp",
    storageDir,
    exportPath: join(storageDir, "exported-session.json"),
    legacyPath: join(storageDir, "legacy.json"),
    toolSchemasForLlm,
    async listTools() {
      const tools = await toolSchemasForLlm();
      return tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
    },
    async callTool(name, args = {}) {
      return normalizeMcpResult(await withTimeout(client.callTool({ name, arguments: args }), `MCP ${name} call`));
    },
    async close() {
      await withTimeout(client.close(), "MCP client close", 5_000);
    },
    get stderr() {
      return stderr;
    },
  };
}

/** @returns {Promise<HostRunner>} */
async function createPiHost(tempRoot) {
  const storageDir = join(tempRoot, "pi-storage");
  mkdirSync(storageDir, { recursive: true });
  const env = createHostEnv(tempRoot, "pi", storageDir);
  const mockPi = createMockPi();
  const extension = (await import(pathToFileURL(extensionPath).href)).default;
  await withProcessEnv(env, async () => extension(mockPi));
  assert.deepEqual(mockPi.registeredFlags, PI_FLAG_NAMES, "pi extension must register source-compatible flags");
  const byName = new Map(mockPi.tools.map((tool) => [tool.name, tool]));

  return {
    name: "pi",
    storageDir,
    exportPath: join(storageDir, "exported-session.json"),
    legacyPath: join(storageDir, "legacy.json"),
    async listTools() {
      return mockPi.tools.map((tool) => ({
        name: tool.name,
        title: tool.label,
        description: tool.description,
        parameters: tool.parameters,
      }));
    },
    async callTool(name, args = {}) {
      const tool = byName.get(name);
      assert.ok(tool, `pi tool not registered: ${name}`);
      return withProcessEnv(env, async () =>
        normalizePiResult(
          await withTimeout(tool.execute(`parity-${name}`, args, undefined, undefined, {}), `pi ${name} call`),
        ),
      );
    },
    async close() {
      return undefined;
    },
  };
}

function contextFor(host) {
  return {
    paths: [host.storageDir, `<absolute:${basename(host.storageDir)}>`],
  };
}

function assertNoRawStoragePath(label, result, host) {
  const raw = JSON.stringify({ textPayload: result.textPayload, structuredPayload: result.structuredPayload });
  assert.equal(raw.includes(host.storageDir), false, `${label} leaked raw ${host.name} storage path`);
}

function collectOverflowTempFile(result) {
  const tempFile = result.structuredPayload?.tempFile;
  if (typeof tempFile === "string") {
    overflowTempFiles.add(tempFile);
  }
}

function assertAgentStructuredContract(label, toolName, result) {
  const structured = result.structuredPayload;
  assert.ok(structured && typeof structured === "object", `${label} must expose structured payload`);
  assert.equal(structured.tool, toolName, `${label} structured payload must name its tool`);
  assert.equal(typeof structured.truncated, "boolean", `${label} structured payload must expose truncation flag`);
  if (result.isError) {
    assert.equal(typeof structured.error, "string", `${label} error result must expose structured error text`);
  } else {
    assert.ok("result" in structured, `${label} success result must expose structured result payload`);
  }
}

async function assertCallParity(label, mcp, pi, name, argsForHost) {
  const mcpArgs = typeof argsForHost === "function" ? argsForHost(mcp) : argsForHost;
  const piArgs = typeof argsForHost === "function" ? argsForHost(pi) : argsForHost;
  const mcpResult = await mcp.callTool(name, mcpArgs);
  const piResult = await pi.callTool(name, piArgs);
  collectOverflowTempFile(mcpResult);
  collectOverflowTempFile(piResult);
  assertAgentStructuredContract(`${label} MCP`, name, mcpResult);
  assertAgentStructuredContract(`${label} pi`, name, piResult);
  if (name !== "export_session" && name !== "import_session") {
    assertNoRawStoragePath(label, mcpResult, mcp);
    assertNoRawStoragePath(label, piResult, pi);
  }
  const normalized = assertNormalizedEqual(label, mcpResult, contextFor(mcp), piResult, contextFor(pi));
  console.log(`✓ ${label} matched`);
  console.log(`  text: ${preview(normalized.textPayload)}`);
  console.log(`  structured: ${structuredPreview(normalized.structuredPayload)}`);
  return { mcpResult, piResult, normalized };
}

function writeLegacyImportFile(host) {
  writeFileSync(
    host.legacyPath,
    JSON.stringify([
      {
        id: "legacy-id",
        thought: "Legacy parity thought",
        thought_number: 4,
        total_thoughts: 4,
        next_thought_needed: false,
        stage: "Conclusion",
        timestamp: "2026-05-16T00:00:00.000Z",
      },
    ]),
    "utf-8",
  );
}

function readExportedPayload(host) {
  return {
    isError: false,
    textPayload: JSON.parse(readFileSync(host.exportPath, "utf-8")),
    structuredPayload: {},
  };
}

function assertEnvStatus(label, result) {
  const status = result.textPayload;
  assert.equal(status?.effectiveConfig?.sources?.storageDir, "env", `${label} storageDir source`);
  assert.equal(status?.effectiveConfig?.sources?.maxBytes, "env", `${label} maxBytes source`);
  assert.equal(status?.effectiveConfig?.sources?.maxLines, "env", `${label} maxLines source`);
}

function propertySignature(property) {
  return [property?.type ?? "", property?.minimum ?? "", property?.maximum ?? "", property?.items?.type ?? ""].join(
    ":",
  );
}

function inputSchemaSummary(schema) {
  return {
    required: schema?.required ?? [],
    additionalProperties: schema?.additionalProperties === true,
    properties: Object.fromEntries(
      Object.entries(schema?.properties ?? {})
        .map(([name, property]) => [name, propertySignature(property)])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    aliasRequirements: (schema?.allOf ?? [])
      .map((entry) =>
        (entry.anyOf ?? [])
          .map((option) => option.required?.[0])
          .filter(Boolean)
          .sort(),
      )
      .sort((left, right) => left.join("|").localeCompare(right.join("|"))),
  };
}

let expectedInputSchemaSummaries;

async function getExpectedInputSchemaSummaries() {
  if (expectedInputSchemaSummaries) return expectedInputSchemaSummaries;
  const toolsModule = await import(pathToFileURL(toolsPath).href);
  expectedInputSchemaSummaries = {
    process_thought: inputSchemaSummary(toolsModule.processThoughtParams),
    generate_summary: inputSchemaSummary(toolsModule.sessionScopedParams),
    clear_history: inputSchemaSummary(toolsModule.clearHistoryParams),
    export_session: inputSchemaSummary(toolsModule.exportSessionParams),
    import_session: inputSchemaSummary(toolsModule.importSessionParams),
    get_thinking_history: inputSchemaSummary(toolsModule.getThinkingHistoryParams),
    get_thinking_status: inputSchemaSummary(toolsModule.getThinkingStatusParams),
    sequential_think: inputSchemaSummary(toolsModule.sequentialThinkParams),
  };
  return expectedInputSchemaSummaries;
}

async function assertMcpSchemas(tools) {
  const expectedInputSchemas = await getExpectedInputSchemaSummaries();
  for (const tool of tools) {
    assert.deepEqual(tool.outputSchema, EXPECTED_OUTPUT_SCHEMA, `${tool.name} MCP outputSchema drifted`);
    assert.deepEqual(
      inputSchemaSummary(tool.inputSchema),
      expectedInputSchemas[tool.name],
      `${tool.name} MCP inputSchema drifted`,
    );
  }
}

function printMcpSchema(tools) {
  if (SHOW_FULL_MCP_SCHEMA) {
    console.log("\nMCP tool schema as returned by tools/list (what the model/client sees):");
    console.log(JSON.stringify(tools, null, 2));
    return;
  }
  console.log(
    "  MCP outputSchema: verified for every tool (set PARITY_SHOW_MCP_SCHEMA=1 to print full tools/list JSON)",
  );
}

async function runParityScenario(mcp, pi) {
  const [mcpTools, piTools, mcpSchemas] = await Promise.all([
    mcp.listTools(),
    pi.listTools(),
    mcp.toolSchemasForLlm?.(),
  ]);
  assert.deepEqual(
    mcpTools.map((tool) => tool.name),
    TOOL_NAMES,
  );
  assert.deepEqual(
    piTools.map((tool) => tool.name),
    TOOL_NAMES,
  );
  const normalizedTools = normalizeValue(mcpTools, { paths: [] });
  assert.deepEqual(normalizedTools, normalizeValue(piTools, { paths: [] }));
  await assertMcpSchemas(mcpSchemas ?? []);
  console.log("✓ listed identical sequential-thinking tool metadata");
  console.log(`  MCP == pi: ${mcpTools.map((tool) => tool.name).join(", ")}`);
  printMcpSchema(mcpSchemas ?? []);

  const initialStatus = await assertCallParity("initial get_thinking_status", mcp, pi, "get_thinking_status", {});
  assertEnvStatus("MCP initial status", initialStatus.mcpResult);
  assertEnvStatus("pi initial status", initialStatus.piResult);

  await assertCallParity("process_thought aliases and lowercase stage", mcp, pi, "process_thought", {
    thought: "Parity thought",
    thoughtNumber: 2,
    totalThoughts: 1,
    nextThoughtNeeded: false,
    stage: "analysis",
    tags: ["parity"],
    sessionId: "research",
  });

  await assertCallParity("generate_summary", mcp, pi, "generate_summary", { sessionId: "research" });

  await assertCallParity("export_session", mcp, pi, "export_session", (host) => ({
    file_path: host.exportPath,
    sessionId: "research",
  }));
  const normalizedExport = assertNormalizedEqual(
    "exported JSON files must match",
    readExportedPayload(mcp),
    contextFor(mcp),
    readExportedPayload(pi),
    contextFor(pi),
  );
  console.log("✓ exported JSON files matched");
  console.log(`  text: ${preview(normalizedExport.textPayload)}`);

  await assertCallParity("clear_history", mcp, pi, "clear_history", { sessionId: "research" });

  writeLegacyImportFile(mcp);
  writeLegacyImportFile(pi);
  await assertCallParity("import_session legacy file", mcp, pi, "import_session", (host) => ({
    file_path: host.legacyPath,
    sessionId: "legacy-import",
  }));

  await assertCallParity("get_thinking_history snippets", mcp, pi, "get_thinking_history", {
    sessionId: "legacy-import",
    includeFullThoughts: false,
  });

  const truncatedHistory = await assertCallParity("truncated history output", mcp, pi, "get_thinking_history", {
    sessionId: "legacy-import",
    includeFullThoughts: false,
    piMaxLines: 4,
    piMaxBytes: 5000,
  });
  assert.equal(truncatedHistory.normalized.structuredPayload.truncated, true);

  await assertCallParity("sequential_think", mcp, pi, "sequential_think", {
    topic: "Parity strategy",
    num_thoughts: 5,
    sessionId: "scratch",
  });

  const finalStatus = await assertCallParity("final get_thinking_status", mcp, pi, "get_thinking_status", {});
  assertEnvStatus("MCP final status", finalStatus.mcpResult);
  assertEnvStatus("pi final status", finalStatus.piResult);
  assert.equal(JSON.stringify(finalStatus.mcpResult.textPayload).includes("Parity thought"), false);
  assert.equal(JSON.stringify(finalStatus.piResult.textPayload).includes("Parity thought"), false);

  await assertCallParity("invalid blank thought", mcp, pi, "process_thought", {
    thought: "   ",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
  });

  await assertCallParity("invalid stage", mcp, pi, "process_thought", {
    thought: "Invalid stage parity",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Nope",
  });

  await assertCallParity("conflicting session aliases", mcp, pi, "generate_summary", {
    session_id: "one",
    sessionId: "two",
  });

  await assertCallParity("conflicting history include aliases", mcp, pi, "get_thinking_history", {
    include_full_thoughts: true,
    includeFullThoughts: false,
  });

  await assertCallParity("fractional sequential_think count", mcp, pi, "sequential_think", {
    topic: "fractional parity",
    num_thoughts: 3.5,
  });

  await assertCallParity("missing import file", mcp, pi, "import_session", (host) => ({
    file_path: join(host.storageDir, "missing.json"),
  }));
}

if (!existsSync(serverPath)) {
  console.error(`Missing built MCP server: ${serverPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:sequential-thinking:parity`.");
  process.exit(1);
}
if (!existsSync(extensionPath)) {
  console.error(`Missing built pi extension: ${extensionPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:sequential-thinking:parity`.");
  process.exit(1);
}
if (!existsSync(toolsPath)) {
  console.error(`Missing built sequential-thinking tools module: ${toolsPath}`);
  console.error("Run `npm run build` first, or use `npm run mcp:sequential-thinking:parity`.");
  process.exit(1);
}

runNormalizationSelfChecks();

let tempRoot;
/** @type {HostRunner | undefined} */
let mcp;
/** @type {HostRunner | undefined} */
let pi;
let cleanupPromise;

async function cleanupResources() {
  cleanupPromise ??= (async () => {
    const cleanupErrors = [];
    for (const host of [mcp, pi]) {
      if (!host) continue;
      try {
        await host.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const filePath of overflowTempFiles) {
      try {
        rmSync(filePath, { force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (tempRoot) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    return cleanupErrors;
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.error(`Received ${signal}; cleaning up sequential-thinking parity resources...`);
    const cleanupErrors = await cleanupResources();
    for (const error of cleanupErrors) {
      console.error(`Cleanup after ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

let primaryError;
try {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-seq-parity-"));
  mcp = await createMcpHost(tempRoot);
  pi = await createPiHost(tempRoot);
  await runParityScenario(mcp, pi);
  console.log("\nSequential-thinking MCP stdio and pi extension behavior match for parity scenarios.");
} catch (error) {
  primaryError = error;
  if (mcp?.stderr?.trim()) {
    console.error(`\nMCP server stderr:\n${mcp.stderr.trim()}`);
  }
} finally {
  const cleanupErrors = await cleanupResources();
  for (const error of cleanupErrors) {
    console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!primaryError && cleanupErrors.length > 0) {
    primaryError = cleanupErrors[0];
  }
}
if (primaryError) throw primaryError;
