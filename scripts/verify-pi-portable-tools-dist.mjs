#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "pi-portable-tools");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

assert.equal(packageJson.main, "./dist/src/index.js", "package main must point at built root entrypoint");
assert.equal(packageJson.types, "./dist/src/index.d.ts", "package types must point at built root declarations");
assert.equal(packageJson.engines?.node, ">=20", "package must declare the supported Node runtime floor");
assert.equal(packageJson.sideEffects, false, "package must declare published modules as side-effect free");
assert.ok(packageJson.files?.includes("llms.txt"), "package files must include llms.txt");
assert.ok(packageJson.files?.includes("examples/README.md"), "package files must include examples/README.md");

const documentationEntries = ["README.md", "llms.txt", "examples/README.md"];
for (const file of documentationEntries) {
  assert.ok(existsSync(join(packageRoot, file)), `missing SDK documentation file: ${file}`);
}

const publicEntries = [
  "dist/src/index.js",
  "dist/src/index.d.ts",
  "dist/src/pi.js",
  "dist/src/pi.d.ts",
  "dist/src/mcp.js",
  "dist/src/mcp.d.ts",
];

function collectJavaScriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

for (const file of publicEntries) {
  const path = join(packageRoot, file);
  assert.ok(existsSync(path), `missing SDK dist file: ${file}`);
  const contents = readFileSync(path, "utf8");
  assert.doesNotMatch(contents, /registerMcpTools/, `${file} must not export registerMcpTools`);
}

for (const path of collectJavaScriptFiles(join(packageRoot, "dist", "src"))) {
  const relativePath = path.slice(packageRoot.length + 1);
  const contents = readFileSync(path, "utf8");
  assert.doesNotMatch(contents, /sourceMappingURL=/, `${relativePath} must not reference unpublished source maps`);
}

console.error("✓ pi-portable-tools package metadata declares entrypoints, engines, side effects, and docs");
console.error("✓ pi-portable-tools dist entrypoints are present");
console.error("✓ pi-portable-tools public entries do not expose registerMcpTools");
console.error("✓ pi-portable-tools dist JavaScript does not reference unpublished source maps");
