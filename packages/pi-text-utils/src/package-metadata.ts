import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getTextUtilsPackageVersion(startUrl = import.meta.url): string {
  let currentDir = dirname(fileURLToPath(startUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = join(currentDir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@feniix/pi-text-utils" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // Keep walking up until we find the package root.
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return "0.0.0";
}
