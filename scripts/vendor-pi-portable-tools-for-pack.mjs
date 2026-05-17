#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = join(repoRoot, "packages", "pi-portable-tools");
const textUtilsRoot = join(repoRoot, "packages", "pi-text-utils");
const vendorRoot = join(textUtilsRoot, "node_modules", "@feniix", "pi-portable-tools");

assert.ok(existsSync(join(sdkRoot, "dist", "src", "index.js")), "build @feniix/pi-portable-tools before vendoring it");
assert.ok(existsSync(join(sdkRoot, "dist", "src", "pi.js")), "missing built pi SDK entrypoint");
assert.ok(existsSync(join(sdkRoot, "dist", "src", "mcp.js")), "missing built MCP SDK entrypoint");

await rm(vendorRoot, { recursive: true, force: true });
await mkdir(vendorRoot, { recursive: true });
await Promise.all([
  cp(join(sdkRoot, "package.json"), join(vendorRoot, "package.json")),
  cp(join(sdkRoot, "README.md"), join(vendorRoot, "README.md")),
  cp(join(sdkRoot, "dist"), join(vendorRoot, "dist"), { recursive: true }),
]);

console.error("✓ vendored @feniix/pi-portable-tools for pi-text-utils packing");
