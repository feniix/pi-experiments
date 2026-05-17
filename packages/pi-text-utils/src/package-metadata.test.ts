import assert from "node:assert/strict";
import test from "node:test";
import { getTextUtilsPackageVersion } from "./package-metadata.js";

test("getTextUtilsPackageVersion reads the package version from package metadata", () => {
  assert.equal(getTextUtilsPackageVersion(), "0.3.0");
});
