#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "pi-sequential-thinking");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

assert.equal(packageJson.engines?.node, ">=20", "package must declare the supported Node runtime floor");
assert.equal(packageJson.bin?.["pi-sequential-thinking-mcp"], "./dist/src/mcp-server.js");
assert.deepEqual(packageJson.pi?.extensions, ["./dist/extensions/index.js"]);
assert.ok(packageJson.files?.includes("README.md"), "package files must include README.md");
assert.ok(packageJson.files?.includes("!dist/**/*.test.*"), "package files must exclude tests");

const requiredEntrypoints = [
  "dist/src/mcp-server.js",
  "dist/src/mcp-server.d.ts",
  "dist/extensions/index.js",
  "dist/extensions/index.d.ts",
];

function collectJavaScriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

for (const file of requiredEntrypoints) {
  assert.ok(existsSync(join(packageRoot, file)), `missing pi-sequential-thinking dist entrypoint: ${file}`);
}

for (const path of collectJavaScriptFiles(join(packageRoot, "dist"))) {
  const relativePath = path.slice(packageRoot.length + 1);
  const contents = readFileSync(path, "utf8");
  assert.doesNotMatch(contents, /sourceMappingURL=/, `${relativePath} must not reference unpublished source maps`);
}

console.error("✓ pi-sequential-thinking package metadata declares entrypoints and docs");
console.error("✓ pi-sequential-thinking dist entrypoints are present");
console.error("✓ pi-sequential-thinking dist JavaScript does not reference unpublished source maps");
