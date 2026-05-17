#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "pi-text-utils");

const requiredEntrypoints = ["dist/src/mcp-server.js", "dist/extensions/index.js"];

function collectJavaScriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

for (const file of requiredEntrypoints) {
  assert.ok(existsSync(join(packageRoot, file)), `missing required pi-text-utils dist entrypoint: ${file}`);
}

const forbiddenEntrypoints = [
  "dist/src/portable/define-tool.js",
  "dist/src/portable/define-tool.d.ts",
  "dist/src/portable/execute-tool.js",
  "dist/src/portable/execute-tool.d.ts",
  "dist/src/adapters/pi.js",
  "dist/src/adapters/pi.d.ts",
  "dist/src/adapters/mcp.js",
  "dist/src/adapters/mcp.d.ts",
];
for (const file of forbiddenEntrypoints) {
  assert.equal(existsSync(join(packageRoot, file)), false, `stale local SDK artifact must not be packed: ${file}`);
}

for (const file of requiredEntrypoints) {
  const contents = readFileSync(join(packageRoot, file), "utf8");
  assert.doesNotMatch(contents, /registerMcpTools/, `${file} must not reference registerMcpTools`);
}

for (const path of collectJavaScriptFiles(join(packageRoot, "dist"))) {
  const relativePath = path.slice(packageRoot.length + 1);
  const contents = readFileSync(path, "utf8");
  assert.doesNotMatch(contents, /sourceMappingURL=/, `${relativePath} must not reference unpublished source maps`);
}

console.error("✓ pi-text-utils dist entrypoints are present");
console.error("✓ pi-text-utils dist does not contain stale local SDK artifacts");
console.error("✓ pi-text-utils dist JavaScript does not reference unpublished source maps");
