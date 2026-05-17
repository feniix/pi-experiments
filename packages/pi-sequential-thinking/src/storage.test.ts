import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ThoughtStorage } from "./storage.js";
import {
  MAX_IMPORT_BYTES,
  SCHEMA_VERSION,
  STATUS_ENUMERATION_SESSION_THRESHOLD,
  type ThoughtData,
  ThoughtStage,
} from "./types.js";

function createThought(overrides: Partial<ThoughtData> = {}): ThoughtData {
  return {
    id: "test-id-1",
    thought: "Test thought content",
    thought_number: 1,
    total_thoughts: 3,
    next_thought_needed: true,
    stage: ThoughtStage.ANALYSIS,
    timestamp: "2026-05-16T00:00:00.000Z",
    tags: [],
    axioms_used: [],
    assumptions_challenged: [],
    ...overrides,
  };
}

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pi-storage-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("persists and isolates default and named sessions", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought({ thought: "Default" }));
  storage.addThought(createThought({ id: "named-id", thought: "Named" }), "architecture-review");

  assert.deepEqual(
    storage.getAllThoughts().map((thought) => thought.thought),
    ["Default"],
  );
  assert.deepEqual(
    storage.getAllThoughts("architecture-review").map((thought) => thought.thought),
    ["Named"],
  );
  assert.equal(existsSync(join(tempDir, "current_session.json")), true);
  assert.equal(existsSync(join(tempDir, "sessions", "architecture-review.json")), true);
});

test("returns bounded history and snippets", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought({ id: "one", thought: "First", thought_number: 1 }), "plan");
  storage.addThought(createThought({ id: "two", thought: "Second", thought_number: 2 }), "plan");
  storage.addThought(createThought({ id: "three", thought: "x".repeat(180), thought_number: 3 }), "plan");

  const history = storage.getHistory({ sessionId: "plan", limit: 2, offset: 1, includeFullThoughts: false });
  assert.equal(history.totalThoughts, 3);
  assert.equal(history.hasMore, false);
  assert.deepEqual(
    history.thoughts.map((thought) => thought.thoughtNumber),
    [2, 3],
  );
  assert.equal(history.thoughts[0].snippet, "Second");
  assert.equal(history.thoughts[1].thought, undefined);
  assert.match(history.thoughts[1].snippet ?? "", /\.\.\.$/);

  assert.throws(() => storage.getHistory({ limit: 0 }), /limit/i);
  assert.throws(() => storage.getHistory({ offset: -1 }), /offset/i);
});

test("exports and imports V1 and legacy sessions", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought({ thought: "Default" }));
  storage.addThought(createThought({ id: "named-id", thought: "Named" }), "research");

  const exportPath = join(tempDir, "export.json");
  const exportResult = storage.exportSession(exportPath, "research");
  assert.equal(exportResult.preCount, 1);
  assert.equal(exportResult.overwroteExistingFile, false);
  const exported = JSON.parse(readFileSync(exportPath, "utf-8"));
  assert.equal(exported.schemaVersion, SCHEMA_VERSION);
  assert.equal(exported.sessionId, "research");
  assert.equal(exported.thoughts[0].thought, "Named");

  const legacyPath = join(tempDir, "legacy.json");
  writeFileSync(
    legacyPath,
    JSON.stringify([
      {
        id: "legacy-id",
        thought: "Legacy thought",
        thought_number: 4,
        total_thoughts: 6,
        next_thought_needed: true,
        stage: "Analysis",
        timestamp: "2026-05-16T00:00:00.000Z",
      },
    ]),
    "utf-8",
  );

  const importResult = storage.importSession(legacyPath, "legacy-import");
  assert.equal(importResult.sessionId, "legacy-import");
  assert.match(importResult.warnings?.join("\n") ?? "", /legacy/i);
  assert.equal(storage.getAllThoughts("legacy-import")[0].thought_number, 4);
});

test("uses embedded session ids and reports explicit-target override warnings", () => {
  const storage = new ThoughtStorage(tempDir);
  const importPath = join(tempDir, "research.json");
  writeFileSync(
    importPath,
    JSON.stringify({ schemaVersion: 1, sessionId: "research", thoughts: [createThought({ thought: "Embedded" })] }),
    "utf-8",
  );

  storage.importSession(importPath);
  assert.equal(storage.getAllThoughts("research")[0].thought, "Embedded");
  assert.deepEqual(storage.getAllThoughts(), []);

  const override = storage.importSession(importPath, "review");
  assert.match(override.warnings?.join("\n") ?? "", /overrides embedded sessionId/);
  assert.equal(storage.getAllThoughts("review")[0].thought, "Embedded");
});

test("reports content-free status with redacted paths and corrupt sessions", () => {
  const homeDir = join(tempDir, "home");
  const homeStorageDir = join(homeDir, ".mcp_sequential_thinking");
  const storage = new ThoughtStorage(homeStorageDir, { homeDir });
  storage.addThought(createThought({ thought: "Sensitive default", tags: ["secret"] }));
  storage.addThought(createThought({ id: "named-id", thought: "Sensitive named" }), "research");
  writeFileSync(join(homeStorageDir, "current_session.json.bak.test"), "{}", "utf-8");

  const status = storage.getStatus({
    effectiveConfig: {
      storageDir: homeStorageDir,
      maxBytes: 51200,
      maxLines: 2000,
      sources: { storageDir: "flag", maxBytes: "default", maxLines: "default" },
    },
  });

  const serialized = JSON.stringify(status);
  assert.match(status.storageDir, /^~/);
  assert.equal(status.pathDisclosure, "home_redacted");
  assert.equal(status.totalThoughts, 2);
  assert.deepEqual(status.backupFiles, ["current_session.json.bak.test"]);
  assert.equal(serialized.includes("Sensitive"), false);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes(homeStorageDir), false);
});

test("guards import/export targets, oversized files, and corrupt active files", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought());

  assert.throws(() => storage.exportSession(tempDir), /directory/i);
  if (process.platform !== "win32") {
    const symlinkPath = join(tempDir, "export-link.json");
    const targetPath = join(tempDir, "target.json");
    writeFileSync(targetPath, "{}", "utf-8");
    try {
      symlinkSync(targetPath, symlinkPath);
    } catch {
      // Unsupported symlink creation is fine for this platform/configuration.
    }
    if (existsSync(symlinkPath) && lstatSync(symlinkPath).isSymbolicLink()) {
      assert.throws(() => storage.exportSession(symlinkPath), /symlink/i);
    }
  }

  assert.throws(() => storage.importSession(join(tempDir, "missing.json")), /File not found/i);
  const oversizedPath = join(tempDir, "oversized.json");
  writeFileSync(oversizedPath, " ".repeat(MAX_IMPORT_BYTES + 1), "utf-8");
  assert.throws(() => storage.importSession(oversizedPath), /10 MiB/i);

  const corruptDir = mkdtempSync(join(tmpdir(), "pi-storage-corrupt-"));
  try {
    const sessionFile = join(corruptDir, "current_session.json");
    writeFileSync(sessionFile, "not valid json {{{{json", "utf-8");
    const corruptStorage = new ThoughtStorage(corruptDir);
    assert.deepEqual(corruptStorage.getAllThoughts(), []);
    assert.equal(
      corruptStorage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak.")),
      true,
    );
  } finally {
    rmSync(corruptDir, { recursive: true, force: true });
  }
});

test("reports partial status after named-session threshold", () => {
  const sessionsDir = join(tempDir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const storage = new ThoughtStorage(tempDir);
  for (let index = 0; index < STATUS_ENUMERATION_SESSION_THRESHOLD + 5; index += 1) {
    writeFileSync(join(sessionsDir, `session-${index}.json`), JSON.stringify({ thoughts: [] }), "utf-8");
  }

  const status = storage.getStatus();
  assert.equal(status.namedSessionCount, STATUS_ENUMERATION_SESSION_THRESHOLD);
  assert.equal(status.totalThoughts, undefined);
  assert.equal(status.statusCompleteness.complete, false);
});

if (process.platform !== "win32") {
  test("uses restrictive directory permissions where supported", () => {
    const storageDir = join(tempDir, "restricted");
    new ThoughtStorage(storageDir);
    assert.equal(statSync(storageDir).mode & 0o077, 0);
  });
}

test("reports corrupt named sessions as incomplete without backing them up", () => {
  const sessionsDir = join(tempDir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const corruptSessionFile = join(sessionsDir, "corrupt.json");
  writeFileSync(corruptSessionFile, "not valid json {{{{json", "utf-8");
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought({ thought: "Default" }));

  const status = storage.getStatus();
  assert.equal(existsSync(corruptSessionFile), true);
  assert.equal(status.totalThoughts, undefined);
  assert.equal(status.statusCompleteness.complete, false);
  assert.match(status.statusCompleteness.reason ?? "", /corrupt/i);
  assert.equal(
    status.backupFiles.some((file) => file.includes("corrupt.json.bak.")),
    false,
  );
  assert.ok(status.sessions.some((session) => session.sessionId === "corrupt" && session.corrupt === true));
});

test("constructor keeps status available when storage directory cannot be created", () => {
  const blockerPath = join(tempDir, "not-a-directory");
  writeFileSync(blockerPath, "blocker", "utf-8");

  const storage = new ThoughtStorage(join(blockerPath, "child"));
  const status = storage.getStatus();

  assert.equal(status.writable, false);
  assert.equal(status.statusCompleteness.complete, false);
  assert.match(status.statusCompleteness.reason ?? "", /Storage initialization failed/);
  assert.throws(() => storage.addThought(createThought()), /ENOTDIR|not a directory/i);
});

if (process.platform !== "win32") {
  test("does not chmod existing export directories", () => {
    const storage = new ThoughtStorage(join(tempDir, "storage"));
    storage.addThought(createThought());
    const exportDir = join(tempDir, "shared-export");
    mkdirSync(exportDir, { recursive: true, mode: 0o755 });
    chmodSync(exportDir, 0o755);

    storage.exportSession(join(exportDir, "session.json"));

    assert.equal(statSync(exportDir).mode & 0o777, 0o755);
  });
}

test("backs up malformed parseable active sessions without overwriting them", () => {
  const sessionFile = join(tempDir, "current_session.json");
  writeFileSync(sessionFile, JSON.stringify({ schemaVersion: 1, thoughts: "not an array" }), "utf-8");

  const storage = new ThoughtStorage(tempDir);

  assert.deepEqual(storage.getAllThoughts(), []);
  assert.equal(existsSync(sessionFile), false);
  assert.equal(
    storage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak.")),
    true,
  );
});

test("getHistory reports corrupt sessions without mutating the active file", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought());
  const sessionFile = join(tempDir, "current_session.json");
  writeFileSync(sessionFile, "not valid json", "utf-8");

  assert.throws(() => storage.getHistory(), /Invalid session file/);
  assert.equal(existsSync(sessionFile), true);
  assert.equal(
    storage.getStatus().backupFiles.some((file) => file.startsWith("current_session.json.bak.")),
    false,
  );
});

test("import receipts detect identical and edited thought content", () => {
  const storage = new ThoughtStorage(tempDir);
  const importPath = join(tempDir, "import.json");
  const originalThought = createThought({ thought: "Original", tags: ["original"] });
  writeFileSync(
    importPath,
    JSON.stringify({ schemaVersion: 1, sessionId: "review", thoughts: [originalThought] }),
    "utf-8",
  );

  assert.equal(storage.importSession(importPath, "review").changed, true);
  assert.equal(storage.importSession(importPath, "review").changed, false);

  writeFileSync(
    importPath,
    JSON.stringify({ schemaVersion: 1, sessionId: "review", thoughts: [{ ...originalThought, thought: "Edited" }] }),
    "utf-8",
  );
  assert.equal(storage.importSession(importPath, "review").changed, true);
  assert.equal(storage.getAllThoughts("review")[0].thought, "Edited");
});

test("rejects oversized session writes before replacing existing history", () => {
  const storage = new ThoughtStorage(tempDir);
  storage.addThought(createThought({ thought: "Small" }));
  assert.throws(
    () => storage.addThought(createThought({ id: "huge", thought: "x".repeat(MAX_IMPORT_BYTES + 1) })),
    /10 MiB/,
  );

  assert.deepEqual(
    storage.getAllThoughts().map((thought) => thought.thought),
    ["Small"],
  );
});

if (process.platform !== "win32") {
  test("rejects special import files before reading them", () => {
    const storage = new ThoughtStorage(tempDir);
    assert.throws(() => storage.importSession("/dev/null"), /special file/);
  });
}

test("recovers stale session locks before writing", () => {
  const storage = new ThoughtStorage(tempDir);
  const lockPath = join(tempDir, "current_session.json.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: 0, createdAt: "1970-01-01T00:00:00.000Z" }), "utf-8");
  const staleDate = new Date(Date.now() - 60_000);
  utimesSync(lockPath, staleDate, staleDate);

  storage.addThought(createThought({ thought: "Recovered" }));

  assert.equal(existsSync(lockPath), false);
  assert.equal(storage.getAllThoughts()[0].thought, "Recovered");
});
