#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "pi-portable-tools");

const publicEntries = [
  "dist/src/index.js",
  "dist/src/index.d.ts",
  "dist/src/pi.js",
  "dist/src/pi.d.ts",
  "dist/src/mcp.js",
  "dist/src/mcp.d.ts",
];

for (const file of publicEntries) {
  const path = join(packageRoot, file);
  assert.ok(existsSync(path), `missing SDK dist file: ${file}`);
  const contents = readFileSync(path, "utf8");
  assert.doesNotMatch(contents, /registerMcpTools/, `${file} must not export registerMcpTools`);
}

console.log("✓ pi-portable-tools dist entrypoints are present");
console.log("✓ pi-portable-tools public entries do not expose registerMcpTools");
