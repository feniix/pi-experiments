---
title: fix: Harden pi-text-utils packaging and parity
type: fix
status: completed
date: 2026-05-16
deepened: 2026-05-16
---

# fix: Harden pi-text-utils packaging and parity

## Summary

Harden the `pi-text-utils` experiment so it remains useful outside the monorepo and preserves pi/MCP behavior parity for successful calls and invalid portable-tool input. The implementation should prove clean package install/bin execution, fix runtime dependency declarations, and close the known pi/MCP validation parity gaps using test-first changes.

---

## Problem Frame

The initial `pi-text-utils` prototype proves that one portable TypeBox-backed tool definition can be exposed through a native pi extension and an MCP stdio server. Code review found that the prototype is not yet robust enough for package-style use: runtime imports are optional peers, dist entrypoints lack clean-install validation, and pi/MCP error parity is incomplete.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- The scope is limited to the previous "next steps 1 and 2": packaging hardening and behavior parity. High-level MCP adapter cleanup and script timeout hardening are deferred.
- The package should remain an experiment package for now, not a fully extracted SDK.
- `@earendil-works/pi-coding-agent` should remain a peer dependency because pi supplies the host API, while `typebox` and `@modelcontextprotocol/sdk` should become package runtime dependencies.

---

## Requirements

- R1. A clean install of the packed `@feniix/pi-text-utils` package must include runtime dependencies required by the MCP bin and portable tool validation.
- R2. Packaging must fail or surface clearly when built dist entrypoints required by `bin` and `pi.extensions` are missing.
- R3. The pi adapter and MCP stdio server must preserve matching behavior for successful calls and invalid portable-tool input.
- R4. MCP must return an explicit tool error for unknown tool names, with coverage proving the contract.
- R5. The implementation must be type-first and test-first: add or update failing tests before changing behavior, then verify with typecheck, unit tests, MCP smoke/parity scripts, and package smoke coverage.

---

## Scope Boundaries

- Do not extract a separate SDK package in this pass.
- Do not migrate to a newer MCP SDK or implement `fromJsonSchema` support in this pass.
- Do not redesign the portable tool API beyond what is needed for dependency hardening and parity.
- Do not add new text utility tool behavior.

### Deferred to Follow-Up Work

- Adapter honesty cleanup: remove, rename, or replace the high-level `registerMcpTools` helper that is not validated against the real installed MCP SDK.
- Script timeout hardening for MCP smoke/manual/parity scripts.
- Full native pi prompt automation, if pi exposes a reliable scriptable prompt runner.

---

## Context & Research

### Relevant Code and Patterns

- `packages/pi-text-utils/package.json` defines the package `files`, `bin`, pi manifest, peer dependencies, and peer dependency metadata.
- `packages/pi-text-utils/src/adapters/pi.ts` maps `PortableToolResult` into pi tool result content/details.
- `packages/pi-text-utils/src/adapters/mcp.ts` uses low-level MCP `Server` request handlers for `tools/list` and `tools/call`, which supports TypeBox JSON Schema with the installed MCP SDK.
- `packages/pi-text-utils/src/portable/execute-tool.ts` centralizes TypeBox validation and produces portable error results.
- `scripts/compare-pi-text-utils-parity.mjs` compares pi-adapter execution with MCP stdio execution for valid calls.
- `packages/pi-text-utils/src/adapters/mcp.integration.test.ts` exercises the MCP server over an in-memory transport.

### Institutional Learnings

- `docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md` established the core architecture rule: portable tools own metadata/schema/execution, while pi and MCP host concerns stay in adapters.

### External References

- Exa research on npm package authoring and MCP SDK usage found that runtime imports belong in `dependencies`, build tooling belongs in `devDependencies`, and `peerDependencies` are for host/shared-instance contracts.
- Local MCP SDK inspection showed `@modelcontextprotocol/sdk@1.29.0` does not expose the newer `fromJsonSchema` helper, so the existing low-level MCP server path remains the compatible path for this pass.

---

## Key Technical Decisions

- Add a clean package smoke test before fixing dependency declarations so the original packaging failure can be observed test-first.
- Move `typebox` and `@modelcontextprotocol/sdk` into `packages/pi-text-utils` runtime `dependencies` because the built MCP server and portable tool code import them at runtime.
- Keep `@earendil-works/pi-coding-agent` as an optional peer because it is the host integration surface for pi and is imported as a TypeScript type only.
- Add package smoke coverage around an actual packed tarball instead of relying only on workspace tests, because the primary risk is missing runtime dependencies or missing built entrypoints after packaging.
- Preserve low-level MCP `Server` handlers for this pass because the installed SDK high-level `McpServer.registerTool` path rejects raw TypeBox schemas.
- Treat invalid portable-tool input as a cross-host parity behavior. Because pi tool result types do not support an `isError` property, invalid portable-tool results in the pi adapter should throw a host-native error. Parity scripts should normalize the thrown pi error to the same `{ isError: true, text, structured }` comparison shape as MCP.

---

## Open Questions

### Resolved During Planning

- Should MCP SDK/typebox remain peers? No — they are runtime imports and should be package dependencies for the experiment package.
- Should the high-level MCP adapter be fixed now? No — it is deferred because the user asked for packaging hardening and parity only.
- How should pi represent invalid portable-tool input? Throw a host-native tool error from the pi adapter, then normalize that thrown error in parity tests/scripts when comparing to MCP's tool-error result.

### Deferred to Implementation

- Exact package smoke implementation details: implementation can choose whether to use `npm pack --json`, `npm install <tgz>` in a temp project, or a focused Node script, as long as it verifies installed bin execution from package dependencies and packed entrypoint presence.

---

## Implementation Units

### U1. Clean package smoke harness

**Goal:** Add a clean install/bin smoke test that proves the packed package works outside the monorepo and exposes the current dependency/entrypoint risks before the manifest is fixed.

**Requirements:** R1, R2, R5

**Dependencies:** None

**Files:**
- Create: `scripts/smoke-pi-text-utils-package.mjs`
- Modify: `package.json`
- Test: `scripts/smoke-pi-text-utils-package.mjs`

**Approach:**
- Add a root script that builds or explicitly requires built output, packs `@feniix/pi-text-utils`, installs the tarball into a temporary project, and runs a minimal MCP call through the installed `pi-text-utils-mcp` bin.
- The smoke should inspect the packed contents or installed package to verify both `dist/src/mcp-server.js` and `dist/extensions/index.js` are present, covering the MCP bin and pi extension entrypoint named by package metadata.
- The smoke should run from the temp project so it cannot silently use root workspace modules.
- For TDD, first implement the smoke against the current manifest and observe failure or incomplete coverage, then use U2 to make it pass.

**Execution note:** Test-first. Write this smoke script and root npm script before changing package dependencies or lifecycle scripts.

**Patterns to follow:**
- `scripts/smoke-pi-text-utils-mcp.mjs` for stdio MCP client setup.
- `scripts/call-pi-text-utils-mcp.mjs` for subprocess stderr capture and JSON output style.

**Test scenarios:**
- Happy path target: a temp project installs the packed tarball, invokes the installed `pi-text-utils-mcp` bin, calls `text_transform` with `operation: "slugify"`, and receives expected text/structured output.
- Entry point path: the smoke verifies packed/installed package files include `dist/src/mcp-server.js` and `dist/extensions/index.js`.
- Isolation path: the smoke starts the installed bin from the temp project, not from the workspace root.

**Verification:**
- The new root package-smoke command exists and fails before U2 if required runtime dependencies or dist entrypoints are not available from the packed package.
- The script emits useful failure output with captured MCP server stderr.

---

### U2. Package runtime dependency and prepack hardening

**Goal:** Make the package smoke pass by declaring runtime dependencies correctly and adding package-level build validation for dist entrypoints.

**Requirements:** R1, R2, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/pi-text-utils/package.json`
- Modify: `package-lock.json`
- Modify: `packages/pi-text-utils/README.md`
- Test: `scripts/smoke-pi-text-utils-package.mjs`

**Approach:**
- Move `typebox` and `@modelcontextprotocol/sdk` from optional peer dependencies to `dependencies` in `packages/pi-text-utils/package.json`.
- Keep `@earendil-works/pi-coding-agent` as an optional peer dependency because pi supplies that host package and the adapter imports it as a type.
- Add package-level build validation through `prepack` or an equivalent package script so missing dist entrypoints are caught before packing.
- Update README only to document the new package-smoke command and any explicit build/pack expectation.

**Execution note:** Type-first / test-first. After U1's smoke is in place, make the smallest manifest/lifecycle changes required for the package smoke to pass.

**Patterns to follow:**
- Current `packages/pi-text-utils/package.json` manifest structure.
- Existing root script naming convention `mcp:text-utils:*`.

**Test scenarios:**
- Package manifest scenario: reading `packages/pi-text-utils/package.json` shows `typebox` and `@modelcontextprotocol/sdk` under `dependencies`, not optional peers.
- Regression scenario: `@earendil-works/pi-coding-agent` remains an optional peer and is not bundled as a runtime dependency.
- Packaging scenario: package-level pack validation catches missing `dist/src/mcp-server.js` or `dist/extensions/index.js` before producing a misleading package.

**Verification:**
- The package manifest and lockfile reflect runtime dependencies correctly.
- `npm run mcp:text-utils:package-smoke` or equivalent succeeds from the repo root.
- `npm pack --dry-run --workspace @feniix/pi-text-utils` includes built JS, declarations, prompts, and README.

---

### U3. Invalid input parity across pi and MCP

**Goal:** Make invalid portable-tool arguments surface consistently through the pi adapter and MCP server, then prove that parity with automation.

**Requirements:** R3, R5

**Dependencies:** U2

**Files:**
- Modify: `packages/pi-text-utils/src/adapters/pi.ts`
- Modify: `packages/pi-text-utils/src/adapters/pi.test.ts`
- Modify: `scripts/compare-pi-text-utils-parity.mjs`
- Test: `packages/pi-text-utils/src/adapters/pi.test.ts`
- Test: `scripts/compare-pi-text-utils-parity.mjs`

**Approach:**
- Add a failing pi adapter test for invalid `text_transform` arguments.
- Make the pi adapter throw when `executePortableTool` returns `isError: true`, using the portable error text and preserving validation details when feasible.
- Extend the parity script with an invalid-input case. The script should catch thrown pi errors and normalize them to `{ text, structured, isError: true }`, then compare that to the MCP `isError: true` result for the same invalid call.

**Execution note:** Test-first. Add the invalid pi adapter test and parity assertion before changing adapter behavior.

**Patterns to follow:**
- Existing `executePortableTool` validation behavior in `packages/pi-text-utils/src/portable/execute-tool.ts`.
- Existing result normalization in `scripts/compare-pi-text-utils-parity.mjs`.

**Test scenarios:**
- Error path: `text_transform` with `operation: "unknown"` causes pi adapter execution to reject with an error containing `Invalid arguments for text_transform`.
- Parity path: the parity script compares invalid-input normalized results and fails if `isError`, text, or structured validation details differ.

**Verification:**
- `npm test` includes the invalid pi adapter coverage.
- `npm run mcp:text-utils:parity` includes and passes invalid-input parity.

---

### U4. Unknown MCP tool contract coverage

**Goal:** Prove that unknown MCP tool names return an explicit MCP tool error instead of hanging or throwing an unstructured protocol failure.

**Requirements:** R4, R5

**Dependencies:** U2

**Files:**
- Modify: `packages/pi-text-utils/src/adapters/mcp.integration.test.ts`
- Test: `packages/pi-text-utils/src/adapters/mcp.integration.test.ts`

**Approach:**
- Add an MCP integration test that calls a missing tool name through the in-memory client/server transport.
- Assert `isError: true` and a useful text response containing the unknown tool name.
- Adjust the MCP server handler only if the current behavior fails the new test.

**Execution note:** Test-first. Add the unknown-tool integration test before touching the MCP handler.

**Patterns to follow:**
- Existing invalid-input assertions in `packages/pi-text-utils/src/adapters/mcp.integration.test.ts`.

**Test scenarios:**
- Error path: calling `missing_tool` returns `isError: true` and text identifying `Unknown tool: missing_tool`.

**Verification:**
- MCP integration tests cover list, valid call, invalid portable-tool input, and unknown tool paths.

---

## System-Wide Impact

- **Interaction graph:** Changes touch package metadata, package smoke scripts, pi adapter result mapping, and MCP integration tests.
- **Error propagation:** Invalid portable-tool input should retain equivalent error status across both host adapters; unknown tool names are an MCP-only server contract.
- **State lifecycle risks:** Package smoke scripts create temporary projects and tarballs; they must clean up or use OS temp directories without mutating the repo outside expected build artifacts.
- **API surface parity:** The pi adapter and MCP stdio path should expose matching tool behavior for successful calls and invalid portable-tool input.
- **Integration coverage:** Clean package install/bin execution is the cross-layer scenario unit tests alone cannot prove.
- **Unchanged invariants:** Tool names, schemas, valid-call outputs, pi prompt templates, and MCP valid-call behavior must remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Package smoke test becomes slow or flaky | Keep it focused on one installed MCP call and no network access. |
| pi host result type does not support `isError` | Throw for invalid portable-tool results and normalize thrown errors in parity tooling. |
| Package lifecycle script causes recursive builds during workspace commands | Use the narrowest lifecycle hook or explicit root smoke script; verify `npm run build`, `npm test`, and `npm pack --dry-run` all still work. |
| Temp install accidentally uses workspace modules | Run the smoke test from a temp project and call the installed bin from that temp project. |

---

## Documentation / Operational Notes

- Update `packages/pi-text-utils/README.md` with the new package smoke command and any lifecycle expectations.
- Keep the README clear that this is still an experiment and SDK extraction is deferred.

---

## Sources & References

- Code review findings from `feat/pi-text-utils` on 2026-05-16.
- Architecture context: `docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md`.
- Related code: `packages/pi-text-utils/src/adapters/pi.ts`, `packages/pi-text-utils/src/adapters/mcp.ts`, `scripts/compare-pi-text-utils-parity.mjs`.
- External research: npm package dependency guidance and MCP SDK TypeBox compatibility findings gathered during review synthesis.
