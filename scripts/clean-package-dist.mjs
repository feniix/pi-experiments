#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageDir = resolve(process.cwd());
await Promise.all([
  rm(join(packageDir, "dist"), { recursive: true, force: true }),
  rm(join(packageDir, "tsconfig.tsbuildinfo"), { force: true }),
]);
