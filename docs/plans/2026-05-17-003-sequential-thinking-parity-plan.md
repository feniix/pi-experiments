---
title: Sequential Thinking MCP/pi Parity Harness
type: feature
status: active
date: 2026-05-17
---

# Sequential Thinking MCP/pi Parity Harness

## Summary

Add a first-class parity command for `packages/pi-sequential-thinking` that invokes the same scenario through the real MCP stdio server and the real pi extension registration path, then compares normalized semantic results. The command should mirror the existing text-utils parity workflow while accounting for sequential-thinking's stateful storage, generated ids, timestamps, receipts, redacted paths, and host envelope differences.

---

## Problem Frame

`npm run mcp:sequential-thinking:smoke` proves the MCP server boots and handles a small workflow. Existing runtime tests prove the pi extension can register tools and run the same domain behavior. There is no single executable check that invokes both host surfaces with the same inputs and proves they remain behaviorally equivalent.

This gap matters because `packages/pi-sequential-thinking` has package-local pi/MCP wiring to preserve source-compatible envelopes and stateful config behavior. A parity harness should catch drift between the two entrypoints without requiring developers to inspect separate test outputs manually.

---

## Scope

### In Scope

- Add `npm run mcp:sequential-thinking:parity` at the workspace root.
- Add `scripts/compare-pi-sequential-thinking-parity.mjs`.
- Invoke MCP through `@modelcontextprotocol/sdk` stdio transport against `packages/pi-sequential-thinking/dist/src/mcp-server.js`.
- Invoke pi by loading `packages/pi-sequential-thinking/dist/extensions/index.js`, registering it against a mock pi API, and calling registered tool `execute` methods.
- Use separate temporary storage directories for MCP and pi so each host receives identical inputs without sharing state.
- Compare normalized semantic outputs for successful and error cases.
- Clean up temp storage even when assertions fail.

### Out of Scope

- Changing sequential-thinking tool behavior.
- Changing BridgeKit adapter APIs.
- Building a generic parity framework for all packages.
- Byte-for-byte comparison of raw host envelopes or volatile generated metadata.
- Publishing or pushing packages.

---

## Requirements Trace

- R1. Developers can run one command to exercise sequential-thinking as MCP and as a pi extension.
- R2. The command verifies both hosts register the same eight tool names.
- R3. The command verifies equivalent behavior for stateful success flows, including aliases, history, summary, import/export, scaffolded thoughts, status, and clear operations.
- R4. The command verifies equivalent behavior for representative validation/error flows.
- R5. The comparison tolerates expected volatile differences: ids, timestamps, saved/export/import times, fingerprints, temp paths, storage paths, and host-specific transport wrappers.
- R6. The script uses timeouts and prints useful context, including MCP stderr, on failure.
- R7. The script does not leave temp storage directories behind.

---

## Key Technical Decisions

- Model the script on `scripts/compare-pi-text-utils-parity.mjs` for stdio MCP connection and result normalization.
- Reuse pi runtime-test patterns from `packages/pi-sequential-thinking/src/runtime.test.ts` for mock pi registration and invocation.
- Compare semantic payloads after parsing JSON text and normalizing volatile fields rather than comparing raw `content`, `details`, and `structuredContent` envelopes.
- Configure both hosts through environment-derived sequential-thinking settings for parity runs: MCP receives env through its child process; pi receives equivalent env by patching `process.env` for the entire pi scenario run, from extension registration through every tool execution, then restoring it in `finally`. This keeps `effectiveConfig.sources.*` comparable while still using separate storage directories.
- Prefer deterministic scenario labels and session ids so assertion failures point to a specific host action.
- Use built `dist` entrypoints only. This validates the same artifacts users run after `npm run build`.

---

## Existing Patterns to Follow

- `scripts/compare-pi-text-utils-parity.mjs` — command shape, MCP stdio setup, timeout helper, normalized host comparison.
- `scripts/smoke-pi-sequential-thinking-mcp.mjs` — sequential-thinking MCP env setup, tool list, result parsing, cleanup.
- `packages/pi-sequential-thinking/src/runtime.test.ts` — mock pi API, tool lookup, pi extension invocation.
- `packages/pi-sequential-thinking/src/mcp.integration.test.ts` — representative sequential-thinking workflows and expected source-compatible behavior.

---

## Implementation Units

### U1: Add parity command and red acceptance check

**Goal:** Introduce the public command before implementation so the first verification fails for the right reason.

**Files:**

- Modify: `package.json`
- Create: `scripts/compare-pi-sequential-thinking-parity.mjs`

**Approach:**

- Add `mcp:sequential-thinking:parity` that builds the workspace and runs the new script.
- Start with a minimal script placeholder that exits non-zero or throws `not implemented`.
- Run the command and confirm it fails before implementing behavior.

**Execution note:** Test-first. This is the red step for the executable parity acceptance test.

**Test scenarios:**

- Running `npm run mcp:sequential-thinking:parity` fails before implementation because the parity script is intentionally incomplete.

**Verification:**

- The failure message clearly comes from the new parity script, not a missing npm script or build error.

---

### U2: Implement typed normalization and host runners

**Goal:** Build the script core that can invoke MCP and pi hosts and normalize their results into comparable values.

**Files:**

- Modify: `scripts/compare-pi-sequential-thinking-parity.mjs`

**Approach:**

- Define the normalization contract first with explicit helper boundaries: host result envelope, parsed payload, normalized payload, and comparison result.
- Implement shared helpers: timeout, text extraction, JSON parsing, volatile-field normalization, deep pruning, and stable temp path redaction.
- Implement MCP host runner using `StdioClientTransport` with `MCP_STORAGE_DIR`, `SEQ_THINK_MAX_BYTES`, and `SEQ_THINK_MAX_LINES` set to deterministic test values in the child env.
- Implement pi host runner with a mock pi API that supports `registerFlag`, `getFlag`, `registerTool`, and `on`, with no overriding flags. Keep `process.env` patched for registration and the full pi scenario execution so storage, max-limit, and status source labels remain env-derived, then restore the original env in `finally`.
- Add normalization self-check fixtures before host startup: one pair that differs only by known volatile fields and must normalize equal, plus one pair that differs in semantic fields and must remain unequal.
- Assert early that both hosts report `effectiveConfig.sources.storageDir`, `maxBytes`, and `maxLines` as `env` before any status normalization.

**Execution note:** Type-first and test-first. Define result shapes/helpers before filling in invocation logic, then keep running the red parity command until the script reaches the first meaningful comparison failure.

**Test scenarios:**

- MCP and pi host runners both list the same eight tool names.
- A single `process_thought` call can be invoked through both hosts and normalized into comparable parsed JSON.
- Host-specific wrappers normalize to the same shape: `{ isError, textPayload, structuredPayload }` before semantic payload normalization.
- Normalized parsed text payloads and normalized structured payloads/details are compared for every success and error case.
- Normalization self-checks prove volatile fields are pruned without hiding semantic drift.

**Verification:**

- `npm run mcp:sequential-thinking:parity` progresses past startup and reports at least one matched parity case before any remaining comparison failures.

---

### U3: Add full parity scenario coverage

**Goal:** Cover the sequential-thinking behaviors most likely to drift between MCP and pi.

**Files:**

- Modify: `scripts/compare-pi-sequential-thinking-parity.mjs`

**Approach:**

- Execute the same ordered scenario against both hosts:
  1. list tools
  2. `process_thought` with camelCase aliases and lowercase stage
  3. `generate_summary`
  4. `export_session`
  5. read both exported JSON files and compare normalized file contents
  6. `clear_history`
  7. write equivalent legacy import files to each host's temp storage and call `import_session`
  8. `get_thinking_history` with snippets
  9. `sequential_think`
  10. `get_thinking_status`
  11. representative invalid input/error cases
- Normalize volatile fields before each deep comparison.
- Print one concise success line per matched scenario.

**Execution note:** Test-first. Add scenario assertions incrementally and run the parity command after each slice, fixing only the code needed for that slice.

**Test scenarios:**

- Success path parity: process, summary, export, clear, import, history, scaffold, and status match semantically.
- Error path parity: blank thought, conflicting session aliases, conflicting history include aliases, invalid stage, and fractional `num_thoughts` match semantically.
- Export side-effect parity: exported MCP and pi files match after volatile metadata normalization.
- Output/status privacy parity: content-free status does not include thought text or raw temp storage paths after normalization.
- Cleanup path: temp dirs are removed through straightforward `try/finally` cleanup.

**Verification:**

- `npm run mcp:sequential-thinking:parity` passes.
- `npm test` passes.
- `npm run check:ci` passes.

---

## Risks and Mitigations

- **Risk:** Over-normalization could hide real host drift.  
  **Mitigation:** Normalize only known volatile keys and paths; compare full remaining payloads; include normalization self-check fixtures that must fail when semantic fields differ.

- **Risk:** MCP stderr warnings from corrupt-file or storage setup obscure failures.  
  **Mitigation:** Capture stderr and print it only on failure, following existing smoke scripts.

- **Risk:** Stateful operations diverge because both hosts accidentally share storage.  
  **Mitigation:** Use separate temp dirs and write equivalent import/export paths for each host.

- **Risk:** Raw JSON text differs while structured payloads match, or vice versa.  
  **Mitigation:** Parse text JSON and also compare normalized structured payloads/details for every case, listing any intentionally volatile fields in the normalization contract.

---

## Validation Plan

Run in order during implementation:

1. `npm run mcp:sequential-thinking:parity` — first red, then green.
2. `npm test`
3. `npm run check:ci`
4. `npm run mcp:sequential-thinking:smoke`
5. `git diff --check`

---

## Completion Criteria

- The new `mcp:sequential-thinking:parity` command exists and passes.
- The script invokes both real built host entrypoints rather than shared tool factories alone.
- The script covers success and error scenarios with normalized deep equality.
- Existing test, lint, typecheck, and smoke workflows remain green.
