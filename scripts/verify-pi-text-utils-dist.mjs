#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const requiredEntrypoints = ["dist/src/mcp-server.js", "dist/extensions/index.js"];
const missing = requiredEntrypoints.filter((path) => !existsSync(resolve(process.cwd(), path)));

if (missing.length > 0) {
  console.error("Missing required pi-text-utils dist entrypoint(s):");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  console.error("Run the package build before packing or publishing.");
  process.exit(1);
}

console.error("✓ pi-text-utils dist entrypoints are present");
