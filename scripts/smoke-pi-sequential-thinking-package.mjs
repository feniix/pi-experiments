#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TIMEOUT_MS = 30_000;
const expectedToolNames = [
  "process_thought",
  "generate_summary",
  "clear_history",
  "export_session",
  "import_session",
  "get_thinking_history",
  "get_thinking_status",
  "sequential_think",
];

function withTimeout(promise, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function executable(command) {
  return process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

async function run(command, args, options = {}) {
  try {
    return await execFile(executable(command), args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      timeout: DEFAULT_TIMEOUT_MS,
      ...options,
    });
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : "";
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}${stdout}${stderr}`);
  }
}

function parsePackOutput(stdout, packDir) {
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const filename = entry.filename ?? entry.name;
  assert.ok(filename, "npm pack JSON output must include filename");
  return resolve(packDir, basename(filename));
}

function textFromContent(content) {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

function parseToolText(text) {
  return JSON.parse(text.replace(/\n\n\[Output truncated:[\s\S]*$/, ""));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

let tempRoot;
let client;
let stderr = "";

try {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-sequential-thinking-package-smoke-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  const installSequentialOnlyDir = join(tempRoot, "install-sequential-only");
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(installSequentialOnlyDir, { recursive: true });

  const sdkPack = await run("npm", [
    "pack",
    "--workspace",
    "@feniix/pi-portable-tools",
    "--pack-destination",
    packDir,
    "--json",
  ]);
  const sdkTarballPath = parsePackOutput(sdkPack.stdout, packDir);
  assert.ok(existsSync(sdkTarballPath), `expected SDK tarball to exist: ${sdkTarballPath}`);

  const sequentialPack = await run("npm", [
    "pack",
    "--workspace",
    "@feniix/pi-sequential-thinking",
    "--pack-destination",
    packDir,
    "--json",
  ]);
  const sequentialTarballPath = parsePackOutput(sequentialPack.stdout, packDir);
  assert.ok(existsSync(sequentialTarballPath), `expected sequential-thinking tarball to exist: ${sequentialTarballPath}`);

  await writeFile(join(installSequentialOnlyDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", sequentialTarballPath], {
    cwd: installSequentialOnlyDir,
  });
  const bundledSdkDir = join(
    installSequentialOnlyDir,
    "node_modules",
    "@feniix",
    "pi-sequential-thinking",
    "node_modules",
    "@feniix",
    "pi-portable-tools",
  );
  assert.ok(
    existsSync(join(bundledSdkDir, "dist", "src", "mcp.js")),
    "pi-sequential-thinking tarball must install its bundled SDK dependency when installed alone",
  );

  const standaloneBin = join(
    installSequentialOnlyDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pi-sequential-thinking-mcp.cmd" : "pi-sequential-thinking-mcp",
  );
  const standaloneStorage = join(installSequentialOnlyDir, "storage");
  const standaloneTransport = new StdioClientTransport({
    command: standaloneBin,
    args: [],
    cwd: installSequentialOnlyDir,
    env: { ...process.env, MCP_STORAGE_DIR: standaloneStorage },
    stderr: "pipe",
  });
  standaloneTransport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const standaloneClient = new Client({ name: "pi-sequential-thinking-standalone-package-smoke", version: "0.1.0" });
  try {
    await withTimeout(standaloneClient.connect(standaloneTransport), "standalone MCP client connect");
    const standaloneList = await withTimeout(standaloneClient.listTools(), "standalone MCP listTools");
    assert.deepEqual(standaloneList.tools.map((tool) => tool.name), expectedToolNames);
    const standaloneResult = await withTimeout(
      standaloneClient.callTool({
        name: "process_thought",
        arguments: {
          thought: "Standalone package smoke",
          thought_number: 1,
          total_thoughts: 1,
          next_thought_needed: false,
          stage: "Analysis",
        },
      }),
      "standalone MCP process_thought call",
    );
    assert.equal(standaloneResult.isError, false);
  } finally {
    await withTimeout(standaloneClient.close(), "standalone MCP client close", 5_000).catch(() => undefined);
  }

  await writeFile(join(installDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", sdkTarballPath, sequentialTarballPath], {
    cwd: installDir,
  });

  const installedSdkDir = join(installDir, "node_modules", "@feniix", "pi-portable-tools");
  const installedPackageDir = join(installDir, "node_modules", "@feniix", "pi-sequential-thinking");
  const installedServer = join(installedPackageDir, "dist", "src", "mcp-server.js");
  const installedPiExtension = join(installedPackageDir, "dist", "extensions", "index.js");
  const installedBin = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pi-sequential-thinking-mcp.cmd" : "pi-sequential-thinking-mcp",
  );

  assert.ok(existsSync(join(installedSdkDir, "dist", "src", "index.js")), "missing installed SDK root entrypoint");
  assert.ok(existsSync(join(installedSdkDir, "dist", "src", "mcp.js")), "missing installed SDK MCP entrypoint");
  assert.ok(existsSync(installedServer), `missing installed MCP server entrypoint: ${installedServer}`);
  assert.ok(existsSync(installedPiExtension), `missing installed pi extension entrypoint: ${installedPiExtension}`);
  assert.ok(existsSync(installedBin), `missing installed MCP bin shim: ${installedBin}`);

  const sequentialPackage = await readJson(join(installedPackageDir, "package.json"));
  const sdkPackage = await readJson(join(installedSdkDir, "package.json"));
  const sdkRange = sequentialPackage.dependencies?.["@feniix/pi-portable-tools"];
  assert.equal(sdkRange, "0.2.0");
  assert.doesNotMatch(sdkRange, /^(workspace:|file:)/);
  assert.equal(sdkPackage.version, "0.2.0");

  const extensionModule = await import(pathToFileURL(installedPiExtension).href);
  const registeredTools = [];
  const piStorage = join(installDir, "pi-storage");
  extensionModule.default({
    registerFlag() {
      return undefined;
    },
    getFlag(name) {
      return name === "--seq-think-storage-dir" ? piStorage : undefined;
    },
    registerTool(tool) {
      registeredTools.push(tool);
    },
  });
  assert.deepEqual(registeredTools.map((tool) => tool.name), expectedToolNames);
  const processTool = registeredTools.find((tool) => tool.name === "process_thought");
  const historyTool = registeredTools.find((tool) => tool.name === "get_thinking_history");
  const statusTool = registeredTools.find((tool) => tool.name === "get_thinking_status");
  assert.ok(processTool && historyTool && statusTool);

  const piProcess = await processTool.execute("call-1", {
    thought: "Installed pi smoke",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
  });
  assert.equal(piProcess.isError, false);
  assert.equal(parseToolText(piProcess.content[0].text).receipt.operation, "process_thought");
  assert.equal(parseToolText((await historyTool.execute("call-2", {})).content[0].text).totalThoughts, 1);
  assert.equal(JSON.stringify(parseToolText((await statusTool.execute("call-3", {})).content[0].text)).includes("Installed pi smoke"), false);
  const piInvalid = await processTool.execute("call-4", {
    thought: "   ",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Analysis",
  });
  assert.equal(piInvalid.isError, true);
  assert.match(piInvalid.content[0].text, /Thought content cannot be empty/);

  const transport = new StdioClientTransport({
    command: installedBin,
    args: [],
    cwd: installDir,
    env: { ...process.env, MCP_STORAGE_DIR: join(installDir, "mcp-storage") },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  client = new Client({ name: "pi-sequential-thinking-package-smoke", version: "0.1.0" });
  await withTimeout(client.connect(transport), "MCP client connect");

  const list = await withTimeout(client.listTools(), "MCP listTools");
  assert.deepEqual(list.tools.map((tool) => tool.name), expectedToolNames);

  const result = await withTimeout(
    client.callTool({
      name: "process_thought",
      arguments: {
        thought: "Installed package smoke",
        thoughtNumber: 1,
        totalThoughts: 1,
        nextThoughtNeeded: false,
        stage: "Analysis",
        sessionId: "installed",
      },
    }),
    "MCP process_thought call",
  );
  assert.equal(result.isError, false);
  assert.equal(parseToolText(textFromContent(result.content)).receipt.sessionId, "installed");

  const invalid = await withTimeout(
    client.callTool({
      name: "process_thought",
      arguments: {
        thought: "   ",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Analysis",
      },
    }),
    "MCP invalid process_thought call",
  );
  assert.equal(invalid.isError, true);
  assert.match(textFromContent(invalid.content), /Thought content cannot be empty/);

  console.log("✓ packed sequential-thinking package installs alone with bundled SDK dependency");
  console.log("✓ packed SDK and sequential-thinking packages install together into a clean temp project");
  console.log("✓ installed MCP bin lists and serves process_thought from declared dependencies");
  console.log("✓ installed package includes and executes pi extension entrypoint");
} catch (error) {
  if (stderr.trim()) {
    console.error(`\nInstalled server stderr:\n${stderr.trim()}`);
  }
  if (tempRoot) {
    console.error(`\nPackage smoke temp dir: ${tempRoot}`);
  }
  throw error;
} finally {
  await withTimeout(client?.close?.() ?? Promise.resolve(), "MCP client close", 5_000).catch(() => undefined);
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
