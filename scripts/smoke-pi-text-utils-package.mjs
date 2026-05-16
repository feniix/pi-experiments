#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout(promise, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
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
  const jsonStart = stdout.indexOf("[\n");
  const jsonText = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
  const parsed = JSON.parse(jsonText);
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

let tempRoot;
let client;
let stderr = "";

try {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-text-utils-package-smoke-"));
  const packDir = join(tempRoot, "pack");
  const installDir = join(tempRoot, "install");
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });

  const pack = await run("npm", ["pack", "--workspace", "@feniix/pi-text-utils", "--pack-destination", packDir, "--json"]);
  const tarballPath = parsePackOutput(pack.stdout, packDir);
  assert.ok(existsSync(tarballPath), `expected tarball to exist: ${tarballPath}`);

  await writeFile(join(installDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", tarballPath], { cwd: installDir });

  const installedPackageDir = join(installDir, "node_modules", "@feniix", "pi-text-utils");
  const installedServer = join(installedPackageDir, "dist", "src", "mcp-server.js");
  const installedPiExtension = join(installedPackageDir, "dist", "extensions", "index.js");
  const installedBin = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pi-text-utils-mcp.cmd" : "pi-text-utils-mcp",
  );
  assert.ok(existsSync(installedServer), `missing installed MCP server entrypoint: ${installedServer}`);
  assert.ok(existsSync(installedPiExtension), `missing installed pi extension entrypoint: ${installedPiExtension}`);
  assert.ok(existsSync(installedBin), `missing installed MCP bin shim: ${installedBin}`);

  const extensionModule = await import(pathToFileURL(installedPiExtension).href);
  const registeredTools = [];
  extensionModule.default({
    registerTool(tool) {
      registeredTools.push(tool.name);
    },
  });
  assert.deepEqual(registeredTools.sort(), ["text_stats", "text_transform"]);

  const transport = new StdioClientTransport({
    command: installedBin,
    args: [],
    cwd: installDir,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  client = new Client({ name: "pi-text-utils-package-smoke", version: "0.1.0" });
  await withTimeout(client.connect(transport), "MCP client connect");

  const result = await withTimeout(
    client.callTool({
      name: "text_transform",
      arguments: { text: "Installed Package Smoke", operation: "slugify" },
    }),
    "MCP text_transform call",
  );

  assert.equal(textFromContent(result.content), "installed-package-smoke");
  assert.deepEqual(result.structuredContent, {
    input: "Installed Package Smoke",
    output: "installed-package-smoke",
    operation: "slugify",
    inputLength: 23,
    outputLength: 23,
  });
  assert.equal(result.isError, false);

  console.log("✓ packed package installs into a clean temp project");
  console.log("✓ installed MCP bin serves text_transform from declared dependencies");
  console.log("✓ installed package includes and loads pi extension entrypoint");
} catch (error) {
  if (stderr.trim()) {
    console.error("\nInstalled server stderr:\n" + stderr.trim());
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
