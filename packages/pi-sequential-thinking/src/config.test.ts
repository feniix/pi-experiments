import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  loadConfigWithSources,
  normalizeNumber,
  normalizeString,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveConfig,
} from "./config.js";

test("resolves effective config values with source labels", () => {
  const effective = resolveEffectiveConfig({
    flags: { storageDir: "/flag/storage", maxBytes: "1000" },
    env: { MCP_STORAGE_DIR: "/env/storage", SEQ_THINK_MAX_BYTES: "2000", SEQ_THINK_MAX_LINES: "3000" },
    config: {
      config: { storageDir: "/config/storage", maxBytes: 111, maxLines: 222 },
      sources: { storageDir: "project_settings", maxBytes: "global_settings", maxLines: "config_file" },
    },
  });

  assert.deepEqual(effective, {
    storageDir: "/flag/storage",
    maxBytes: 1000,
    maxLines: 3000,
    sources: { storageDir: "flag", maxBytes: "flag", maxLines: "env" },
  });
});

test("falls back to config and defaults in effective config", () => {
  const effective = resolveEffectiveConfig({
    flags: {},
    env: {},
    config: { config: { storageDir: "/project/storage" }, sources: { storageDir: "project_settings" } },
  });

  assert.deepEqual(effective, {
    storageDir: "/project/storage",
    maxBytes: 51200,
    maxLines: 2000,
    sources: { storageDir: "project_settings", maxBytes: "default", maxLines: "default" },
  });
});

test("normalizes strings, numbers, and config files", () => {
  assert.equal(normalizeString("  hello  "), "hello");
  assert.equal(normalizeString("   "), undefined);
  assert.equal(normalizeNumber(42), 42);
  assert.equal(normalizeNumber("123"), 123);
  assert.equal(normalizeNumber("abc"), undefined);

  assert.deepEqual(parseConfig({ storageDir: "  /custom/storage  ", maxBytes: 1024, maxLines: 500 }, "/path"), {
    storageDir: "/custom/storage",
    maxBytes: 1024,
    maxLines: 500,
  });
  assert.throws(() => parseConfig(null, "/path"), /Invalid Sequential Thinking config/);
});

test("resolves config paths", () => {
  assert.equal(resolveConfigPath("~/.pi/config.json"), join(homedir(), ".pi/config.json"));
  assert.equal(resolveConfigPath("/absolute/path/to/config.json"), "/absolute/path/to/config.json");
  assert.equal(resolveConfigPath("relative/path.json"), resolve(process.cwd(), "relative/path.json"));
});

test("loads project and global settings with project precedence", () => {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const tempHome = mkdtempSync(join(tmpdir(), "pi-seq-think-settings-home-"));
  const tempProject = mkdtempSync(join(tmpdir(), "pi-seq-think-settings-project-"));

  mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
  mkdirSync(join(tempProject, ".pi"), { recursive: true });
  writeFileSync(
    join(tempHome, ".pi", "agent", "settings.json"),
    JSON.stringify({ "pi-sequential-thinking": { maxBytes: 111 } }),
    "utf-8",
  );
  writeFileSync(
    join(tempProject, ".pi", "settings.json"),
    JSON.stringify({ "pi-sequential-thinking": { storageDir: "/tmp/thoughts", maxLines: 22 } }),
    "utf-8",
  );

  process.env.HOME = tempHome;
  process.chdir(tempProject);
  try {
    assert.deepEqual(loadConfigWithSources(undefined)?.config, {
      storageDir: "/tmp/thoughts",
      maxBytes: 111,
      maxLines: 22,
    });
  } finally {
    process.chdir(originalCwd);
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
  }
});
