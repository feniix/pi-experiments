#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function textFromContent(content) {
  assert.ok(Array.isArray(content), "tool result content must be an array");
  assert.equal(content[0]?.type, "text");
  return content[0].text;
}

async function assertSdkRuntimeExports(installDir) {
  const code = `
    import assert from "node:assert/strict";
    import * as core from "@feniix/pi-portable-tools";
    import * as pi from "@feniix/pi-portable-tools/pi";
    import * as mcp from "@feniix/pi-portable-tools/mcp";
    assert.deepEqual(Object.keys(core).sort(), ["definePortableTool", "executePortableTool", "validatePortableToolArgs"]);
    assert.deepEqual(Object.keys(pi).sort(), ["PortableToolExecutionError", "isPortableToolExecutionError", "registerPiTools"]);
    assert.deepEqual(Object.keys(mcp).sort(), ["createMcpServer", "runMcpStdioServer"]);
    assert.equal(["register", "McpTools"].join("") in mcp, false);
  `;
  await run(process.execPath, ["--input-type=module", "-e", code], { cwd: installDir });
}

async function assertSdkTypesCompile(installDir) {
  const typecheckFile = join(installDir, "sdk-consumer.ts");
  await writeFile(
    typecheckFile,
    `
      import { Type, type Static } from "typebox";
      import {
        definePortableTool,
        executePortableTool,
        type PortableToolResult,
      } from "@feniix/pi-portable-tools";
      import {
        isPortableToolExecutionError,
        PortableToolExecutionError,
      } from "@feniix/pi-portable-tools/pi";
      import { type CreateMcpServerOptions } from "@feniix/pi-portable-tools/mcp";

      const params = Type.Object({ text: Type.String() });
      type Params = Static<typeof params>;
      const tool = definePortableTool({
        name: "typecheck_tool",
        title: "Typecheck Tool",
        description: "Typecheck fixture.",
        parameters: params,
        execute(args) {
          const typed: Params = args;
          return { text: typed.text, structuredContent: { text: typed.text } };
        },
      });

      const options: CreateMcpServerOptions = {
        name: "typecheck-server",
        version: "0.1.0",
        tools: [tool],
      };
      void options;

      async function run(): Promise<PortableToolResult> {
        return executePortableTool(tool, { text: "hello" }, { host: "test" });
      }
      void run;

      const error: unknown = new PortableToolExecutionError({
        text: "bad",
        structuredContent: { validationErrors: [] },
        isError: true,
      });
      if (isPortableToolExecutionError(error)) {
        const details: Record<string, unknown> = error.details;
        const validationErrors = error.details.validationErrors;
        void details;
        void validationErrors;
      }
    `,
  );

  const tsc = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  await run(
    tsc,
    [
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      typecheckFile,
    ],
    { cwd: installDir },
  );
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

  const textUtilsPack = await run("npm", [
    "pack",
    "--workspace",
    "@feniix/pi-text-utils",
    "--pack-destination",
    packDir,
    "--json",
  ]);
  const textUtilsTarballPath = parsePackOutput(textUtilsPack.stdout, packDir);
  assert.ok(existsSync(textUtilsTarballPath), `expected text-utils tarball to exist: ${textUtilsTarballPath}`);

  await writeFile(join(installDir, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", sdkTarballPath, textUtilsTarballPath], {
    cwd: installDir,
  });

  const installedSdkDir = join(installDir, "node_modules", "@feniix", "pi-portable-tools");
  const installedPackageDir = join(installDir, "node_modules", "@feniix", "pi-text-utils");
  const installedServer = join(installedPackageDir, "dist", "src", "mcp-server.js");
  const installedPiExtension = join(installedPackageDir, "dist", "extensions", "index.js");
  const installedBin = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pi-text-utils-mcp.cmd" : "pi-text-utils-mcp",
  );

  assert.ok(existsSync(join(installedSdkDir, "dist", "src", "index.js")), "missing installed SDK root entrypoint");
  assert.ok(existsSync(join(installedSdkDir, "dist", "src", "pi.js")), "missing installed SDK pi entrypoint");
  assert.ok(existsSync(join(installedSdkDir, "dist", "src", "mcp.js")), "missing installed SDK MCP entrypoint");
  assert.ok(existsSync(installedServer), `missing installed MCP server entrypoint: ${installedServer}`);
  assert.ok(existsSync(installedPiExtension), `missing installed pi extension entrypoint: ${installedPiExtension}`);
  assert.ok(existsSync(installedBin), `missing installed MCP bin shim: ${installedBin}`);

  const textUtilsPackage = await readJson(join(installedPackageDir, "package.json"));
  const sdkPackage = await readJson(join(installedSdkDir, "package.json"));
  const sdkRange = textUtilsPackage.dependencies?.["@feniix/pi-portable-tools"];
  assert.equal(sdkRange, "0.1.0");
  assert.doesNotMatch(sdkRange, /^(workspace:|file:)/);
  assert.equal(sdkPackage.version, "0.1.0");

  await assertSdkRuntimeExports(installDir);
  await assertSdkTypesCompile(installDir);

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

  const list = await withTimeout(client.listTools(), "MCP listTools");
  assert.deepEqual(
    list.tools.map((tool) => tool.name).sort(),
    ["text_stats", "text_transform"],
  );

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

  const invalid = await withTimeout(
    client.callTool({
      name: "text_transform",
      arguments: { text: "Hello", operation: "not-a-real-operation" },
    }),
    "MCP invalid text_transform call",
  );
  assert.equal(invalid.isError, true);
  assert.match(textFromContent(invalid.content), /Invalid arguments for text_transform/);
  assert.deepEqual(invalid.structuredContent?.tool, "text_transform");
  assert.ok(Array.isArray(invalid.structuredContent?.validationErrors));

  console.log("✓ packed SDK and text-utils packages install into a clean temp project");
  console.log("✓ installed SDK runtime and declaration subpath exports work");
  console.log("✓ installed MCP bin lists and serves text_transform from declared dependencies");
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
