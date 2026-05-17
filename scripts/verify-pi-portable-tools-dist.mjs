#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "pi-portable-tools");

const requiredFiles = [
  "dist/src/index.js",
  "dist/src/index.d.ts",
];

for (const file of requiredFiles) {
  const path = join(packageRoot, file);
  assert.ok(existsSync(path), `missing SDK dist file: ${file}`);
}

const indexJs = readFileSync(join(packageRoot, "dist/src/index.js"), "utf8");
assert.doesNotMatch(indexJs, /registerMcpTools/, "SDK root must not export registerMcpTools");

console.log("✓ pi-portable-tools core dist entrypoints are present");
