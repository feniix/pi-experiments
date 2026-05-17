#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = join(repoRoot, "packages", "pi-portable-tools");
const targetPackage = process.argv[2] ?? "pi-text-utils";
const targetRoot = join(repoRoot, "packages", targetPackage);
const vendorRoot = join(targetRoot, "node_modules", "@feniix", "pi-portable-tools");

assert.match(targetPackage, /^pi-[a-z0-9-]+$/, "target package must be a local pi-* package directory name");
assert.ok(existsSync(targetRoot), `unknown target package: ${targetPackage}`);
assert.ok(existsSync(join(sdkRoot, "dist", "src", "index.js")), "build @feniix/pi-portable-tools before vendoring it");
assert.ok(existsSync(join(sdkRoot, "dist", "src", "pi.js")), "missing built pi SDK entrypoint");
assert.ok(existsSync(join(sdkRoot, "dist", "src", "mcp.js")), "missing built MCP SDK entrypoint");

await rm(vendorRoot, { recursive: true, force: true });
await mkdir(vendorRoot, { recursive: true });
const copyTasks = [
  cp(join(sdkRoot, "package.json"), join(vendorRoot, "package.json")),
  cp(join(sdkRoot, "README.md"), join(vendorRoot, "README.md")),
  cp(join(sdkRoot, "dist"), join(vendorRoot, "dist"), { recursive: true }),
];
if (targetPackage !== "pi-text-utils") {
  copyTasks.push(
    cp(join(sdkRoot, "llms.txt"), join(vendorRoot, "llms.txt")),
    cp(join(sdkRoot, "examples"), join(vendorRoot, "examples"), { recursive: true }),
  );
}
await Promise.all(copyTasks);

console.error(`✓ vendored @feniix/pi-portable-tools for ${targetPackage} packing`);
