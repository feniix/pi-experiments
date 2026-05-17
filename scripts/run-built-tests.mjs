#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packagesDir = join(repoRoot, "packages");

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectTestFiles(path);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
    }),
  );

  return files.flat();
}

const packages = await readdir(packagesDir, { withFileTypes: true });
const testFiles = (
  await Promise.all(
    packages
      .filter((entry) => entry.isDirectory())
      .map((entry) => collectTestFiles(join(packagesDir, entry.name, "dist"))),
  )
).flat().sort();

if (testFiles.length === 0) {
  throw new Error("No built test files found under packages/*/dist. Run npm run build first.");
}

const child = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
