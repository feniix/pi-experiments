import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTextUtilsPackageVersion } from "./package-metadata.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("getTextUtilsPackageVersion reads the package version from package metadata", async () => {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version: string };

  assert.equal(getTextUtilsPackageVersion(), pkg.version);
});

test("getTextUtilsPackageVersion returns a fallback when package metadata is unavailable", () => {
  const missingPackageUrl = pathToFileURL(join(tmpdir(), "missing-pi-text-utils-package", "dist", "file.js")).href;

  assert.equal(getTextUtilsPackageVersion(missingPackageUrl), "0.0.0");
});
