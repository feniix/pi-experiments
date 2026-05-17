#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await rm(join(repoRoot, "packages", "pi-sequential-thinking", "node_modules"), {
  recursive: true,
  force: true,
});
