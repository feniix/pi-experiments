---
title: Add Portable Sequential Thinking Package
type: feat
status: completed
date: 2026-05-17
---

# Add Portable Sequential Thinking Package

## Summary

Create `packages/pi-sequential-thinking` by porting the existing `../pi-extensions/packages/pi-sequential-thinking` behavior into this repo’s portable-tool architecture. The new package must expose the same sequential-thinking tool behavior through both a native pi extension and an MCP stdio server, with shared TypeBox-backed portable tool definitions built on `@feniix/bridgekit`.

---

## Problem Frame

The source `pi-sequential-thinking` package currently works only as a native pi extension and mixes domain logic, storage, config, output formatting, and pi registration in one package. This repo now has a reusable portable tool SDK, so the next incubation should prove that a larger, stateful, content-bearing extension can keep its behavior while gaining MCP support from the same tool definitions.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- “Behave the same way” means preserve the user-visible behavior and data contracts of the source pi extension for existing tools, storage layout, validation messages, receipts, config precedence, and content-free status output unless a host transport requires a different envelope.
- MCP support should use the existing low-level MCP adapter from `@feniix/bridgekit/mcp`; no new MCP helper API belongs in the SDK for this work.
- Because `@feniix/bridgekit` is not assumed to be published yet, the new package should mirror `pi-text-utils` and bundle the SDK dependency for packed-install smoke tests.
- Tests remain repo/dev artifacts and should not be included in npm tarballs.

---

## Requirements

### Package shape

- R1. Add `packages/pi-sequential-thinking` as an npm workspace package with Node `>=20`, ESM-only TypeScript build output, package metadata, pi extension entrypoint, and MCP stdio bin entrypoint.
- R3. Define the tools once as `@feniix/bridgekit` portable tools and reuse that definition for both pi and MCP hosts.

### Behavior parity

- R2. Preserve the existing eight tool names and behavior from `../pi-extensions/packages/pi-sequential-thinking`: `process_thought`, `generate_summary`, `clear_history`, `export_session`, `import_session`, `get_thinking_history`, `get_thinking_status`, and `sequential_think`.
- R4. Preserve existing storage semantics: default and named session files, V1 JSON envelopes, legacy JSON import compatibility, import/export validation, corruption backup behavior, redacted status diagnostics, bounded history, 10 MiB size guard, and one-writer plaintext local-storage assumption.
- R5. Preserve existing input contracts: TypeBox schemas with snake_case and camelCase aliases, runtime validation messages, conflicting-alias detection, dynamic `total_thoughts` adjustment, and session ID restrictions. Runtime normalizers are authoritative where source behavior is broader or more specific than TypeBox pre-validation.
- R6. Preserve existing output contracts as closely as host envelopes allow: JSON text responses, structured details/receipts, truncation behavior, temp-file fallback, progress updates for pi, and content-free status/receipt diagnostics.

### MCP/package verification

- R7. Add MCP coverage proving the MCP server lists all tools, executes every tool through representative stateful calls, returns `isError: true` for invalid calls, honors source-compatible config wiring through MCP startup, and uses the same underlying behavior as the pi extension.
- R8. Add package verification and smoke coverage proving clean packed installs include the expected entrypoints, docs, bundled SDK dependency, MCP bin, and pi extension entrypoint without publishing tests or stale artifacts.

### Development process

- R9. Execute implementation with type-first and test-first development; write failing characterization/type/integration tests before porting each behavior slice.

---

## Scope Boundaries

- Do not add new sequential-thinking tools, stages, storage backends, locking, network transports, prompts, or product behavior beyond MCP access to the existing tools.
- Do not change the `@feniix/bridgekit` public API unless a preservation test proves it is unavoidable; prefer package-local adapters for source-package compatibility details.
- Do not generalize shared packaging scripts beyond the minimum needed to let a second bundled SDK consumer pack cleanly while keeping existing `pi-text-utils` behavior green.
- Do not publish to npm.
- Do not remove or alter existing `pi-text-utils` behavior.
- Do not convert this repo from short-lived experiments/incubations into durable product documentation.

### Deferred to Follow-Up Work

- Remove SDK bundling workarounds after `@feniix/bridgekit` is published and downstream packages can depend on it normally.
- Add a lock or multi-writer coordination strategy for shared storage directories only if a future experiment requires concurrent writers.

---

## Context & Research

### Relevant Code and Patterns

- `packages/pi-text-utils/package.json`, `packages/pi-text-utils/extensions/index.ts`, `packages/pi-text-utils/src/mcp-server.ts`, and `packages/pi-text-utils/src/tools/index.ts` show the current portable package, pi extension, and MCP server pattern.
- `packages/bridgekit/src/core/define-tool.ts`, `packages/bridgekit/src/adapters/pi.ts`, and `packages/bridgekit/src/adapters/mcp.ts` define the SDK contract and supported host adapters.
- `scripts/smoke-pi-text-utils-package.mjs`, `scripts/verify-pi-text-utils-dist.mjs`, and `scripts/run-built-tests.mjs` show package-smoke and built-test conventions.
- `../pi-extensions/packages/pi-sequential-thinking/extensions/index.ts`, `types.ts`, `storage.ts`, and `analyzer.ts` are the source behavior to port and characterize.
- Root `package.json` and `tsconfig.json` need workspace scripts/references for the new package.

### Institutional Learnings

- `docs/plans/2026-05-16-002-extract-portable-tool-sdk-plan.md` established the shared portable TypeBox tool contract, explicit `/pi` and `/mcp` SDK subpaths, and the rule that unsupported helpers such as `registerMcpTools` must not reappear.
- `docs/plans/2026-05-16-001-fix-text-utils-hardening-parity-plan.md` showed that package correctness needs clean packed-install smoke tests, not only workspace unit tests.
- `docs/plans/2026-05-17-001-portable-tools-publish-polish-plan.md` established the SDK’s Node `>=20`, ESM-only, source-map-free package contract.
- `docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md` established that host-neutral portable tool definitions must not import pi or MCP host APIs.

### External References

- No external research is needed; the work is governed by local source behavior and existing repo SDK/package patterns.

---

## Key Technical Decisions

- Port source behavior by separating domain/runtime code from host adapters: domain types, analyzer, storage, config resolution, and output formatting live under `packages/pi-sequential-thinking/src`, while pi flags/registration live in `extensions/index.ts` and MCP stdio startup lives in `src/mcp-server.ts`.
- Use a tool factory, not global singleton tools. `createSequentialThinkingTools(...)` should construct tools around a specific `ThoughtStorage`, `ThoughtAnalyzer`, and config provider so pi and MCP hosts can initialize storage/config independently while sharing definitions.
- Treat source runtime normalizers as the authoritative validation layer for behavior-sensitive inputs. Portable TypeBox schemas should stay permissive for fields such as `stage`, aliases, and optional runtime-required values when strict schema validation would preempt source-compatible validation messages or case-insensitive normalization.
- Preserve pi’s current user-visible error envelope with a package-local pi registration wrapper, because the generic SDK pi adapter throws on `isError` portable results while the source package returns `{ content, details, isError: true }`. This wrapper still uses `definePortableTool` and `executePortableTool` from the SDK, with permissive schemas preventing SDK pre-validation from replacing source errors.
- Use local output-formatting utilities for truncation and size formatting instead of importing `@earendil-works/pi-coding-agent` at runtime from portable code. The pi host package remains a type-only optional peer.
- MCP should use `runMcpStdioServer` from `@feniix/bridgekit/mcp` and the same portable tools. MCP-specific differences should be limited to MCP’s standard `content`, `structuredContent`, and `isError` envelope.
- Keep tests as characterization plus parity tests. The safest path is to copy source tests, retarget imports to the new package structure, then add MCP and package-smoke tests around the same behavior.
- Minimally extend SDK vendoring support so a second bundled SDK consumer can pack cleanly without disrupting `pi-text-utils` package smoke.

---

## Open Questions

### Resolved During Planning

- Should the new package use the existing SDK pi adapter directly? No. Preservation requires source-compatible pi error results, so use a package-local pi wrapper over SDK core execution.
- Which validation layer is authoritative? Source runtime normalizers are authoritative; portable schemas are intentionally permissive where strict TypeBox validation would reject source-accepted values or erase source validation details.
- Should MCP get new functionality such as extra CLI flags? No. Use env/settings/default config parity and the existing tool set only.
- Should source maps be published? No. Match the existing package polish and disable package source maps.

### Deferred to Implementation

- Exact internal module split can be adjusted while porting source tests, provided the public package entrypoints and behavior remain unchanged.
- Whether all source tests copy cleanly or need host-envelope-specific assertions is an implementation-time discovery item; behavior expectations should remain the source package’s expectations.

---

## Output Structure

    packages/pi-sequential-thinking/
      package.json
      README.md
      tsconfig.json
      extensions/
        index.ts
      src/
        analyzer.ts
        config.ts
        mcp-server.ts
        output.ts
        pi-registration.ts
        storage.ts
        tools.ts
        types.ts
        *.test.ts
        *.integration.test.ts
    scripts/
      smoke-pi-sequential-thinking-mcp.mjs
      smoke-pi-sequential-thinking-package.mjs
      verify-pi-sequential-thinking-dist.mjs
      vendor-bridgekit-for-pack.mjs

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
  Domain[Sequential thinking domain\nTypes + Analyzer + Storage + Config + Output] --> Factory[createSequentialThinkingTools]
  Factory --> Tools[PortableTool definitions\nTypeBox schemas + execute]
  Tools --> Pi[pi extension wrapper\nflags + compatible result envelope + progress]
  Tools --> MCP[MCP stdio server\nrunMcpStdioServer]
  SDK[@feniix/bridgekit\ndefine/execute + MCP adapter] --> Factory
  SDK --> Pi
  SDK --> MCP
```

The shared portable tools own behavior. Host entrypoints own only host-specific startup, config sources, and result envelopes. Progress updates remain pi-wrapper behavior unless a preservation test proves the portable core must expose a hook for source-compatible pi progress.

---

## Implementation Units

### U1. Scaffold package and characterize source domain behavior

**Goal:** Create the workspace package skeleton and add failing characterization/type tests for the source sequential-thinking behavior before porting implementation files.

**Requirements:** R1, R2, R4, R5, R9

**Dependencies:** None

**Files:**
- Create: `packages/pi-sequential-thinking/package.json`
- Create: `packages/pi-sequential-thinking/tsconfig.json`
- Create: `packages/pi-sequential-thinking/README.md`
- Create: `packages/pi-sequential-thinking/src/types.test.ts`
- Create: `packages/pi-sequential-thinking/src/analyzer.test.ts`
- Create: `packages/pi-sequential-thinking/src/storage.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `package-lock.json`

**Approach:**
- Start from the source package tests for `types`, `analyzer`, and `storage`, retargeting imports to the planned `src` modules.
- Add the package manifest and TypeScript project reference so the tests are part of the workspace build.
- Run the targeted build/test path to observe failing tests before copying implementation.

**Execution note:** Test-first and types-first. The first meaningful change is the test/type scaffold; implementation files should be absent or skeletal until the failing behavior is captured.

**Patterns to follow:**
- `packages/pi-text-utils/package.json`
- `packages/pi-text-utils/tsconfig.json`
- `../pi-extensions/packages/pi-sequential-thinking/__tests__/types.test.ts`
- `../pi-extensions/packages/pi-sequential-thinking/__tests__/analyzer.test.ts`
- `../pi-extensions/packages/pi-sequential-thinking/__tests__/storage.test.ts`

**Test scenarios:**
- Happy path: thought stages parse case-insensitively and valid thought input normalizes to the same internal shape as the source package.
- Edge case: conflicting aliases, invalid session IDs, oversized thought counts, and empty thought strings produce source-compatible validation errors.
- Happy path: analyzer finds related thoughts, summaries, timelines, tags, and completion status as in the source package.
- Integration: storage persists default/named sessions, imports/exports V1 and legacy JSON, reports content-free status, backs up corrupt active files, and rejects oversized files.

**Verification:**
- The new package is included in `tsc -b` and the copied characterization tests are present and fail against missing or skeletal implementation before U2 ports the domain files.

---

### U2. Port domain, config, and output utilities without host dependencies

**Goal:** Move the source package’s reusable logic into host-neutral `src` modules while preserving validation, storage, config, output truncation, and receipt behavior.

**Requirements:** R2, R4, R5, R6, R9

**Dependencies:** U1

**Files:**
- Create: `packages/pi-sequential-thinking/src/types.ts`
- Create: `packages/pi-sequential-thinking/src/analyzer.ts`
- Create: `packages/pi-sequential-thinking/src/storage.ts`
- Create: `packages/pi-sequential-thinking/src/config.ts`
- Create: `packages/pi-sequential-thinking/src/output.ts`
- Create: `packages/pi-sequential-thinking/src/config.test.ts`
- Create: `packages/pi-sequential-thinking/src/output.test.ts`

**Approach:**
- Port `types.ts`, `analyzer.ts`, and `storage.ts` nearly verbatim from the source package.
- Extract config helpers from the source `extensions/index.ts` into `src/config.ts` so both pi and MCP entrypoints can resolve the same env/settings/default behavior.
- Extract output formatting and truncation helpers into `src/output.ts`, replacing pi runtime utility imports with local equivalents.
- Keep all modules free of MCP SDK and pi host imports.

**Execution note:** Test-first. Add config/output tests from the source helper tests before implementing local helpers.

**Patterns to follow:**
- `../pi-extensions/packages/pi-sequential-thinking/extensions/types.ts`
- `../pi-extensions/packages/pi-sequential-thinking/extensions/analyzer.ts`
- `../pi-extensions/packages/pi-sequential-thinking/extensions/storage.ts`
- Helper tests in `../pi-extensions/packages/pi-sequential-thinking/__tests__/helpers.test.ts`

**Test scenarios:**
- Happy path: config precedence resolves flags, env, project settings, global settings, config file, and defaults with source labels.
- Edge case: legacy config aliases warn but remain supported where source behavior supports them.
- Edge case: output truncation clamps requested limits to configured max limits and writes temp files only when needed.
- Error path: temp-file write failure warns but does not convert successful tool execution into an error.

**Verification:**
- Domain/config/output tests pass without importing `@earendil-works/pi-coding-agent` at runtime, including the characterization tests introduced in U1.

---

### U3. Define portable sequential-thinking tools once

**Goal:** Build the eight sequential-thinking tools with `definePortableTool` and a runtime factory that reuses the ported domain logic for every host.

**Requirements:** R2, R3, R4, R5, R6, R9

**Dependencies:** U2

**Files:**
- Create: `packages/pi-sequential-thinking/src/tools.ts`
- Create: `packages/pi-sequential-thinking/src/tools.test.ts`
- Modify: `packages/pi-sequential-thinking/src/types.ts`
- Modify: `packages/pi-sequential-thinking/src/storage.ts`
- Modify: `packages/pi-sequential-thinking/src/output.ts`

**Approach:**
- Move TypeBox schemas from the source extension into `src/tools.ts`, but loosen behavior-sensitive schema fields when SDK pre-validation would otherwise block source runtime normalization.
- Implement `createSequentialThinkingTools(options)` around a `ThoughtStorage`, `ThoughtAnalyzer`, and max-limit config provider.
- Each portable tool should emit `PortableToolResult` with JSON text and `structuredContent` details matching the source tool `details` as closely as possible.
- Tool errors should become `PortableToolResult` values with `isError: true`, source-compatible text, and validation details rather than unexpected throws.
- Add a shared host conformance fixture incrementally: start with direct portable execution in U3, then extend the same scenarios through the pi wrapper in U4 and MCP in U5 while allowing only documented envelope differences.

**Execution note:** Test-first. Start with portable tool tests that call `executePortableTool` directly for success, validation, receipts, truncation, and error cases before implementing tool definitions.

**Patterns to follow:**
- `packages/pi-text-utils/src/tools/text-transform.ts`
- Source tool implementations inside `../pi-extensions/packages/pi-sequential-thinking/extensions/index.ts`
- `packages/bridgekit/src/core/execute-tool.test.ts`

**Test scenarios:**
- Happy path: `process_thought` records a thought, returns analysis and receipt metadata, and supports camelCase aliases.
- Happy path: summary, history, clear, export, import, status, and `sequential_think` behave like the source package across default and named sessions.
- Edge case: `total_thoughts` is adjusted upward only for the incoming thought when `thought_number` is larger.
- Edge case: `get_thinking_history` supports pagination and `include_full_thoughts` aliases.
- Error path: invalid thought content, missing import path, conflicting session aliases, invalid history aliases, and empty `topic` return source-compatible error results.
- Integration: `get_thinking_status` remains content-free and redacts home-relative paths.

**Verification:**
- Direct portable tool tests pass and prove every tool is defined once as a portable tool, with source-compatible validation preserved despite SDK pre-validation.

---

### U4. Add pi extension wrapper with source-compatible host behavior

**Goal:** Register the portable tools as a native pi extension while preserving the source package’s flags, config behavior, progress updates, and pi result/error envelope.

**Requirements:** R1, R2, R3, R5, R6, R9

**Dependencies:** U3

**Files:**
- Create: `packages/pi-sequential-thinking/extensions/index.ts`
- Create: `packages/pi-sequential-thinking/src/pi-registration.ts`
- Create: `packages/pi-sequential-thinking/src/pi-registration.test.ts`
- Create: `packages/pi-sequential-thinking/src/runtime.test.ts`

**Approach:**
- Register the same five CLI flags from the source extension.
- Resolve storage/config at extension initialization and max output limits per call, matching source behavior.
- Use SDK core execution (`executePortableTool`) from the package-local pi registration wrapper. Return source-compatible pi results with `content`, `details`, and `isError` rather than the generic SDK pi adapter's throw-on-error behavior.
- Reuse source runtime tests to verify tool registration, flags, pending updates, receipts, session scoping, status redaction, and validation errors.
- Invoke every registered tool through the pi wrapper at least once across the conformance/runtime tests, with `process_thought` specifically asserting the pending progress update.

**Execution note:** Test-first. Add pi registration/runtime tests before implementing the extension wrapper.

**Patterns to follow:**
- `packages/pi-text-utils/extensions/index.ts`
- `@feniix/bridgekit/pi` adapter behavior as a reference, not a mandatory envelope when source compatibility requires package-local handling
- `../pi-extensions/packages/pi-sequential-thinking/__tests__/index.test.ts`
- `../pi-extensions/packages/pi-sequential-thinking/__tests__/runtime.test.ts`

**Test scenarios:**
- Happy path: extension registers the same tools and flags as the source package.
- Happy path: runtime calls through the pi wrapper produce source-compatible JSON text, details, progress updates, and mutation receipts.
- Error path: invalid runtime inputs return `isError: true` with `Sequential Thinking error: ...` text and `validationErrors` details.
- Edge case: deprecated flag/env config aliases warn while still resolving as in the source package.
- Integration: pi wrapper conformance covers all eight tools, including content JSON, details/receipts, session scoping, and representative `isError` behavior.

**Verification:**
- Pi registration/runtime tests pass against the portable tools without duplicating tool behavior.

---

### U5. Add MCP server, MCP integration tests, and parity smoke

**Goal:** Expose the same portable tools as an MCP stdio server and verify stateful behavior through MCP client calls.

**Requirements:** R1, R2, R3, R6, R7, R9

**Dependencies:** U3

**Files:**
- Create: `packages/pi-sequential-thinking/src/mcp-server.ts`
- Create: `packages/pi-sequential-thinking/src/mcp.integration.test.ts`
- Create: `scripts/smoke-pi-sequential-thinking-mcp.mjs`
- Modify: `package.json`

**Approach:**
- Implement MCP startup with `runMcpStdioServer` and server metadata resolved in `src/mcp-server.ts` without a separate metadata abstraction.
- Use only the source-compatible config inputs that are available to the MCP process, preserving existing env/config/default semantics where applicable; do not add MCP-specific config keys, prompts, flags, or precedence layers.
- Add in-memory MCP integration tests using the already-exported `createMcpServer` from `@feniix/bridgekit/mcp`, plus stdio smoke tests following existing text-utils patterns.
- Add only the root smoke/package verification scripts needed by existing repo conventions; rely on the package MCP bin as the executable server entrypoint.

**Execution note:** Test-first. Add MCP integration tests that fail while no MCP server exists, then implement the server.

**Patterns to follow:**
- `packages/pi-text-utils/src/mcp-server.ts`
- `packages/pi-text-utils/src/mcp-consumer.integration.test.ts`
- `scripts/smoke-pi-text-utils-mcp.mjs`

**Test scenarios:**
- Integration: MCP `tools/list` returns exactly the eight sequential-thinking tools with TypeBox schemas.
- Happy path: MCP conformance invokes all eight tools through representative stateful calls, including summary, clear, export, import, and `sequential_think`.
- Error path: MCP invalid arguments return `isError: true` and structured validation/error details.
- Edge case: MCP status output remains content-free and redacted.
- Integration: MCP server startup with temp env/settings config uses the configured storage directory and max output limits visible through status/truncation behavior.

**Verification:**
- `npm run mcp:sequential-thinking:smoke` passes after a clean build.

---

### U6. Add package verification, packed-install smoke, and vendoring support

**Goal:** Prove the new package builds and installs cleanly outside the workspace with expected entrypoints, bundled SDK dependency, MCP bin, and pi extension.

**Requirements:** R1, R3, R8, R9

**Dependencies:** U4, U5

**Files:**
- Create: `scripts/verify-pi-sequential-thinking-dist.mjs`
- Create: `scripts/smoke-pi-sequential-thinking-package.mjs`
- Modify: `scripts/vendor-bridgekit-for-pack.mjs`
- Create: `scripts/cleanup-pi-sequential-thinking-vendor.mjs`
- Modify: `packages/pi-sequential-thinking/package.json`
- Modify: `package.json`

**Approach:**
- Extend the existing SDK vendoring script with the minimum target-package parameter needed to vendor the built SDK into either `pi-text-utils` or `pi-sequential-thinking`, preserving the current default behavior for `pi-text-utils`.
- Add a sequential-thinking-specific cleanup script instead of rewriting existing text-utils cleanup unless tests prove shared cleanup is necessary.
- Add a package verifier that asserts dist entrypoints, no source-map references, no published tests, expected docs, and no stale unsupported SDK artifacts.
- Add package smoke that packs SDK and sequential-thinking, installs into temp projects, runs the MCP bin, imports the pi extension default export, executes representative registered pi handlers, and confirms bundled SDK availability when installed alone.

**Execution note:** Test-first. Write verifier/smoke assertions before updating package metadata and vendoring scripts to satisfy them.

**Patterns to follow:**
- `scripts/verify-pi-text-utils-dist.mjs`
- `scripts/smoke-pi-text-utils-package.mjs`
- `scripts/vendor-bridgekit-for-pack.mjs`
- `scripts/cleanup-pi-text-utils-vendor.mjs`

**Test scenarios:**
- Packed package includes `dist/src/mcp-server.js`, `dist/extensions/index.js`, declarations, and README.
- Packed package excludes source tests, typecheck artifacts, and source maps.
- Installed package bin lists and calls the expected MCP tools.
- Installed pi extension default export registers all tools through a mocked pi API and can execute `process_thought`, `get_thinking_history`, `get_thinking_status`, and one representative error case from the installed tarball.
- Installing the sequential-thinking tarball alone also installs its bundled SDK dependency.

**Verification:**
- `npm run mcp:sequential-thinking:package-smoke` passes from a clean build.

---

### U7. Full verification and documentation polish

**Goal:** Finish the package documentation and run the complete repo verification suite for the new branch.

**Requirements:** R1, R2, R7, R8, R9

**Dependencies:** U6

**Files:**
- Modify: `packages/pi-sequential-thinking/README.md`
- Modify: `docs/plans/2026-05-17-002-feat-portable-sequential-thinking-plan.md` *(status flip only after completion)*

**Approach:**
- Keep package README focused on install, config, tools, pi/MCP entrypoints, storage/privacy notes, and behavior parity with the source package.
- Do not update the root README for this package; keep package-specific details local.
- Run lint, typecheck, tests, MCP smoke, package smoke, and git whitespace checks.

**Execution note:** Verification-first. Do not mark the plan completed until all required checks pass.

**Patterns to follow:**
- `packages/pi-text-utils/README.md`
- `../pi-extensions/packages/pi-sequential-thinking/README.md`
- Root `README.md` package-agnostic guidance

**Test scenarios:**
- Test expectation: none for prose-only README edits beyond existing verifier/package-smoke checks that package docs are present.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run mcp:sequential-thinking:smoke`
- `npm run mcp:sequential-thinking:package-smoke`
- `npm run check:ci`
- `git diff --check`

---

## System-Wide Impact

- **Interaction graph:** Adds a third workspace package and new root scripts. Existing SDK and text-utils packages should keep their current build/test/package behavior.
- **Error propagation:** Source tool errors become portable `isError` results. The pi wrapper must preserve source-compatible pi error results; the MCP adapter should surface MCP-standard `isError: true` results.
- **State lifecycle risks:** Sequential thinking persists local plaintext JSON and writes import/export files. The port must retain atomic writes, restrictive permissions where supported, corruption backup, symlink/directory guards, and size checks.
- **API surface parity:** The same eight tool schemas and names must be available through pi and MCP. No unsupported SDK helper exports should be introduced.
- **Integration coverage:** Unit tests cover domain behavior; pi runtime tests cover extension envelopes; MCP integration/smoke covers protocol behavior; package smoke covers clean install/bin/extension behavior.
- **Unchanged invariants:** Existing `pi-text-utils` scripts, SDK exports, package metadata, and behavior remain unchanged except for generalized vendoring scripts that must keep existing package smoke green.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Porting a large source extension could accidentally change edge-case behavior | Start with copied characterization tests and preserve source modules nearly verbatim before refactoring host seams |
| Generic SDK pi adapter may not match source pi error envelope | Use package-local pi registration over SDK core execution when preservation tests require it |
| Stateful MCP tests may leak local files | Use temp storage directories and clean them after tests/smokes |
| Bundling the local SDK for multiple packages could create stale vendor artifacts | Keep vendoring changes minimal, add a sequential-thinking cleanup script, and verify both existing text-utils and new sequential package smoke flows |
| Package smoke may pass in workspace but fail as installed package | Pack/install into temp projects and run installed binaries/imports rather than workspace paths |
| Root README could become package-detail documentation | Keep package-specific details inside `packages/pi-sequential-thinking/README.md` |

---

## Documentation / Operational Notes

- `packages/pi-sequential-thinking/README.md` should document both pi install and MCP bin usage, config precedence, storage layout, tool parameters, privacy/storage notes, and Node requirement.
- The package remains an incubation experiment in this repo; it is not published by this plan.
- The source package version is `@feniix/pi-sequential-thinking@4.0.0`; the new workspace package version should start as an unpublished incubation version chosen during implementation and should not imply an npm publish.

---

## Sources & References

- Source package: `../pi-extensions/packages/pi-sequential-thinking`
- Portable package pattern: `packages/pi-text-utils`
- SDK package: `packages/bridgekit`
- Architecture plan: `docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md`
- SDK extraction plan: `docs/plans/2026-05-16-002-extract-portable-tool-sdk-plan.md`
- Package hardening plan: `docs/plans/2026-05-16-001-fix-text-utils-hardening-parity-plan.md`
- Publish polish plan: `docs/plans/2026-05-17-001-portable-tools-publish-polish-plan.md`
