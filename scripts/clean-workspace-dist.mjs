#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");
const entries = await readdir(packagesDir, { withFileTypes: true });

await Promise.all(
  entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const packageDir = join(packagesDir, entry.name);
      return [
        rm(join(packageDir, "dist"), { recursive: true, force: true }),
        rm(join(packageDir, "tsconfig.tsbuildinfo"), { force: true }),
      ];
    }),
);
