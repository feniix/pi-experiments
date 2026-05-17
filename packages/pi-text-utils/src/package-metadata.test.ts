import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { getTextUtilsPackageVersion } from "./package-metadata.js";

test("getTextUtilsPackageVersion reads the package version from package metadata", () => {
  assert.equal(getTextUtilsPackageVersion(), "0.3.0");
});

test("getTextUtilsPackageVersion returns a fallback when package metadata is unavailable", () => {
  const missingPackageUrl = pathToFileURL(join(tmpdir(), "missing-pi-text-utils-package", "dist", "file.js")).href;

  assert.equal(getTextUtilsPackageVersion(missingPackageUrl), "0.0.0");
});
