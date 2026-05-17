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
const VOLATILE_KEYS = new Set([
  "id",
  "timestamp",
  "savedAt",
  "exportedAt",
  "importedAt",
  "stateFingerprint",
  "lastUpdated",
  "tempFile",
]);
const MEASUREMENT_KEYS = new Set(["totalBytes", "outputBytes", "totalLines", "outputLines"]);

/** @typedef {{ isError: boolean, textPayload: unknown, structuredPayload: unknown }} ComparableResult */
/** @typedef {{ name: string, storageDir: string, exportPath: string, legacyPath: string, listTools: () => Promise<string[]>, callTool: (name: string, args?: Record<string, unknown>) => Promise<ComparableResult>, close: () => Promise<void> }} HostRunner */

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

function normalizeString(value, context) {
  let output = value;
  for (const path of context.paths) {
    output = output.split(path).join("<path>");
    output = output.split(`<absolute:${basename(path)}>`).join("<path>");
  }
  return output;
}

function normalizeValue(value, context) {
  if (typeof value === "string") return normalizeString(value, context);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, context));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => !VOLATILE_KEYS.has(key) && entry !== undefined)
      .map(([key, entry]) => {
        if (key === "filePath" || key === "storageDir") return [key, normalizeString(String(entry), context)];
        if (key === "truncation" && entry && typeof entry === "object") {
          return [
            key,
            Object.fromEntries(
              Object.entries(entry).map(([truncationKey, truncationValue]) => [
                truncationKey,
                MEASUREMENT_KEYS.has(truncationKey) ? "<measurement>" : normalizeValue(truncationValue, context),
              ]),
            ),
          ];
        }
        return [key, normalizeValue(entry, context)];
      }),
  );
}

function normalizeComparableResult(result, context) {
  return {
    isError: result.isError,
    textPayload: normalizeValue(result.textPayload, context),
    structuredPayload: normalizeValue(result.structuredPayload, context),
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

function runNormalizationSelfChecks() {
  const leftContext = { paths: ["/tmp/pi-seq-parity-left", "<absolute:pi-seq-parity-left>"] };
  const rightContext = { paths: ["/tmp/pi-seq-parity-right", "<absolute:pi-seq-parity-right>"] };
  const left = {
    isError: false,
    textPayload: {
      id: "left-id",
      timestamp: "2026-05-17T00:00:00.000Z",
      filePath: "/tmp/pi-seq-parity-left/export.json",
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
      id: "right-id",
      timestamp: "2026-05-17T00:00:01.000Z",
      filePath: "/tmp/pi-seq-parity-right/export.json",
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

async function withPatchedEnv(env, operation) {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function createMcpHost(tempRoot) {
  const storageDir = join(tempRoot, "mcp-storage");
  mkdirSync(storageDir, { recursive: true });
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repoRoot,
    env: {
      ...process.env,
      MCP_STORAGE_DIR: storageDir,
      SEQ_THINK_MAX_BYTES: "51200",
      SEQ_THINK_MAX_LINES: "2000",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "pi-sequential-thinking-parity-mcp", version: "0.1.0" });
  try {
    await withTimeout(client.connect(transport), "MCP client connect");
  } catch (error) {
    await withTimeout(client.close(), "MCP client close after failed connect", 5_000).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.trim() ? `${message}\nMCP server stderr:\n${stderr.trim()}` : message, { cause: error });
  }

  return {
    name: "mcp",
    storageDir,
    exportPath: join(storageDir, "exported-session.json"),
    legacyPath: join(storageDir, "legacy.json"),
    async listTools() {
      const list = await withTimeout(client.listTools(), "MCP listTools");
      return list.tools.map((tool) => ({
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
      await withTimeout(client.close(), "MCP client close", 5_000).catch(() => undefined);
    },
    get stderr() {
      return stderr;
    },
  };
}

async function createPiHost(tempRoot) {
  const storageDir = join(tempRoot, "pi-storage");
  mkdirSync(storageDir, { recursive: true });
  const env = {
    MCP_STORAGE_DIR: storageDir,
    SEQ_THINK_MAX_BYTES: "51200",
    SEQ_THINK_MAX_LINES: "2000",
  };
  const mockPi = createMockPi();
  const extension = (await import(pathToFileURL(extensionPath).href)).default;
  await withPatchedEnv(env, async () => extension(mockPi));
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
      return withPatchedEnv(env, async () =>
        normalizePiResult(await tool.execute(`parity-${name}`, args, undefined, undefined, {})),
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

async function assertCallParity(label, mcp, pi, name, argsForHost) {
  const mcpArgs = typeof argsForHost === "function" ? argsForHost(mcp) : argsForHost;
  const piArgs = typeof argsForHost === "function" ? argsForHost(pi) : argsForHost;
  const [mcpResult, piResult] = await Promise.all([mcp.callTool(name, mcpArgs), pi.callTool(name, piArgs)]);
  const normalized = assertNormalizedEqual(label, mcpResult, contextFor(mcp), piResult, contextFor(pi));
  console.log(`✓ ${label} matched`);
  console.log(`  MCP == pi: ${preview(normalized.textPayload)}`);
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

async function runParityScenario(mcp, pi) {
  const [mcpTools, piTools] = await Promise.all([mcp.listTools(), pi.listTools()]);
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
  console.log("✓ listed identical sequential-thinking tool metadata");
  console.log(`  MCP == pi: ${mcpTools.map((tool) => tool.name).join(", ")}`);

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
  console.log(`  MCP == pi: ${preview(normalizedExport.textPayload)}`);

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

runNormalizationSelfChecks();

let tempRoot;
let mcp;
let pi;
try {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-seq-parity-"));
  mcp = await createMcpHost(tempRoot);
  pi = await createPiHost(tempRoot);
  await runParityScenario(mcp, pi);
  console.log("\nSequential-thinking MCP stdio and pi extension behavior match for parity scenarios.");
} catch (error) {
  if (mcp?.stderr?.trim()) {
    console.error(`\nMCP server stderr:\n${mcp.stderr.trim()}`);
  }
  throw error;
} finally {
  await Promise.all([mcp?.close?.(), pi?.close?.()].filter(Boolean)).catch(() => undefined);
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
}
