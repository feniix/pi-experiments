---
title: Polish pi-portable-tools Publish Contract
type: refactor
status: completed
date: 2026-05-17
---

# Polish pi-portable-tools Publish Contract

## Summary

Tighten `@feniix/pi-portable-tools` as a publishable TypeScript SDK by making package metadata explicit, keeping emitted source-map behavior consistent with the tarball, and widening the host context type for future adapters without changing current pi or MCP runtime behavior.

---

## Problem Frame

The SDK extraction has a good modern ESM/TypeScript foundation, but a few library-polish gaps remain before treating it as a durable published package: legacy tooling metadata is absent, the package claims no side-effect contract, emitted JavaScript references source maps that are not published, and `PortableToolContext.host` is closed to only first-party hosts.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- “Do 1-5” refers to the five cleanup items from the immediately preceding best-practices assessment in this session: add `engines`, add `sideEffects`, add `main`/`types`, fix source-map packaging, and make `PortableToolContext.host` extensible. No separate requirements document exists for that assessment.
- Source-map consistency should be solved by disabling source maps for the SDK package build rather than publishing `.js.map` files, because this package is tiny and does not currently publish source `.ts` files.
- ESM-only is still intentional; this plan does not add CommonJS output.

---

## Requirements

- R1. `packages/pi-portable-tools/package.json` must explicitly advertise runtime entry metadata for modern and older tooling: `exports`, `main`, `types`, `engines`, and `sideEffects`.
- R2. The packed `@feniix/pi-portable-tools` tarball must not contain JavaScript files with dangling `sourceMappingURL` comments.
- R3. `PortableToolContext.host` must accept existing first-party hosts and future custom adapter host identifiers without loosening the rest of the context contract or breaking the default closed first-party host union used by existing consumers.
- R4. Existing root, pi, and MCP public entrypoints must remain stable; no unsupported helper such as `registerMcpTools` may reappear.
- R5. The work must be implemented test-first/types-first and verified through the existing typecheck, test, and package-smoke flows.

---

## Scope Boundaries

- Do not add CommonJS or dual-package output.
- Do not split `@feniix/pi-portable-tools` into separate core/pi/MCP packages in this branch.
- Do not publish to npm.
- Do not change pi or MCP runtime behavior beyond type/metadata/package-output polish.
- Do not add new text utility behavior.

---

## Context & Research

### Relevant Code and Patterns

- `packages/pi-portable-tools/package.json` already uses explicit `exports`, `files`, `prepack`, and dependency declarations.
- `packages/pi-portable-tools/tsconfig.json` inherits root `sourceMap: true`, which currently produces `.js` files containing `sourceMappingURL` comments while the package `files` field excludes `.js.map` files.
- `packages/pi-portable-tools/src/core/define-tool.ts` defines `PortableToolContext.host` as the closed union `"pi" | "mcp" | "test"`.
- `scripts/verify-pi-portable-tools-dist.mjs` is the right place to assert package-output invariants before packing.
- `scripts/smoke-pi-text-utils-package.mjs` already verifies installed SDK runtime exports and declaration imports from a packed install.

### Institutional Learnings

- `docs/plans/2026-05-16-002-extract-portable-tool-sdk-plan.md` established that the SDK should expose root, pi, and MCP subpaths while keeping the public API small and honest.
- Prior package-smoke hardening showed that clean packed installs are the reliable proof for package metadata and dependency correctness.

### External References

- Node.js TypeScript publishing guidance: publish compiled JavaScript plus generated declarations, not raw TypeScript.
- TypeScript `module` guidance: `NodeNext` is appropriate for modern Node projects.
- npm package metadata guidance: use `exports`, `files`, and `engines` to define the published package contract.
- webpack tree-shaking guidance: set `sideEffects: false` only for import-passive modules.

---

## Key Technical Decisions

- Keep the package ESM-only and Node-oriented; add `main` and `types` only as compatibility metadata, not as an alternate module format.
- Add `"engines": { "node": ">=20" }` to match the pi runtime baseline and this repo’s Node-based development scripts. This SDK has not been published from this repo yet; before any future npm publish, treat the engine floor as release-note-worthy contract metadata and document it in the README so engine-strict consumers are not surprised.
- Add `"sideEffects": false` because the published modules are import-passive; behavior starts only when callers invoke exported functions.
- Disable source-map emission at the SDK package level so the published JavaScript does not reference missing `.map` files.
- Preserve the default closed first-party host union while adding generic extensibility: export `PortableToolBuiltInHost = "pi" | "mcp" | "test"`, `PortableToolHost<TExtension extends string = never> = PortableToolBuiltInHost | TExtension`, and thread the host generic through `PortableToolContext`, `PortableTool`, and `executePortableTool`. This is included now because the SDK is explicitly intended for userland portable adapters; without the generic, custom-adapter authors must either lie with `host: "test"` or cast through `never`.

---

## Open Questions

### Resolved During Planning

- Publish source maps or disable them? Disable them for this small package; publishing maps without sources is low-value, and the immediate correctness issue is dangling map references.
- Add CJS output for broader compatibility? No. ESM-only remains consistent with the repo and MCP SDK usage.
- Make host a plain `string`? No. Keep known first-party literals for autocomplete/documentation and add an extensible string arm for custom adapters.

### Deferred to Implementation

- None. Package-output assertions belong in `scripts/verify-pi-portable-tools-dist.mjs`; installed-consumer declaration checks belong in `scripts/smoke-pi-text-utils-package.mjs` only where they uniquely prove packed-install behavior.

---

## Implementation Units

### U1. Lock package metadata contract

**Goal:** Add explicit published-package metadata for compatibility, runtime support, and tree-shaking.

**Requirements:** R1, R4, R5

**Dependencies:** None

**Files:**
- Modify: `packages/pi-portable-tools/package.json`
- Modify: `scripts/verify-pi-portable-tools-dist.mjs`
- Test: `scripts/verify-pi-portable-tools-dist.mjs`
- Test: `scripts/smoke-pi-text-utils-package.mjs` *(verification only; modify only if installed-consumer behavior needs extra proof)*

**Approach:**
- Extend the verifier first so it fails unless `main`, `types`, `engines.node`, and `sideEffects` match the intended contract.
- Then update package metadata to satisfy the verifier.

**Execution note:** Test-first. Add the failing verifier assertions before changing `package.json`.

**Patterns to follow:**
- Existing assertions in `scripts/verify-pi-portable-tools-dist.mjs`
- Installed SDK export checks in `scripts/smoke-pi-text-utils-package.mjs`

**Test scenarios:**
- Package metadata has `main` pointing at `./dist/src/index.js`.
- Package metadata has `types` pointing at `./dist/src/index.d.ts`.
- Package metadata has `engines.node` set to `>=20`.
- Package metadata has `sideEffects: false`.
- Existing public subpath export checks still pass.
- Public entrypoint files continue to assert that `registerMcpTools` is absent.

**Verification:**
- `npm run prepack --workspace @feniix/pi-portable-tools`
- `npm run mcp:text-utils:package-smoke`

---

### U2. Remove dangling source-map references from SDK package output

**Goal:** Ensure compiled SDK JavaScript published to npm does not reference missing source-map files.

**Requirements:** R2, R5

**Dependencies:** None

**Files:**
- Modify: `packages/pi-portable-tools/tsconfig.json`
- Modify: `scripts/verify-pi-portable-tools-dist.mjs`
- Test: `scripts/verify-pi-portable-tools-dist.mjs`

**Approach:**
- Add a verifier check that scans published SDK `.js` files under `dist/src` and fails if any contain `sourceMappingURL=`.
- Disable source maps in `packages/pi-portable-tools/tsconfig.json` so a clean SDK build satisfies the verifier.

**Execution note:** Test-first. Make the verifier catch the current dangling map references before changing the package tsconfig.

**Patterns to follow:**
- Existing dist verification in `scripts/verify-pi-portable-tools-dist.mjs`
- `scripts/clean-package-dist.mjs` clean-build behavior

**Test scenarios:**
- Clean SDK build emits `.js` and `.d.ts` entrypoints.
- No SDK runtime `.js` file contains a `sourceMappingURL` comment.
- Packed tarball still excludes test and typecheck artifacts.

**Verification:**
- `npm run prepack --workspace @feniix/pi-portable-tools`
- `npm pack --workspace @feniix/pi-portable-tools --dry-run --json`

---

### U3. Make portable host context extensible

**Goal:** Allow custom adapters to identify themselves in `PortableToolContext.host` without changing SDK source for every new host, while preserving the default closed built-in host union for existing consumers.

**Requirements:** R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `packages/pi-portable-tools/src/core/define-tool.ts`
- Modify: `packages/pi-portable-tools/src/core/execute-tool.ts`
- Modify: `packages/pi-portable-tools/src/core/execute-tool.test.ts`
- Modify: `packages/pi-portable-tools/src/index.ts`
- Modify: `scripts/smoke-pi-text-utils-package.mjs`
- Test: `packages/pi-portable-tools/src/core/execute-tool.test.ts`
- Test: installed SDK declaration compile fixture inside `scripts/smoke-pi-text-utils-package.mjs`

**Approach:**
- Add type-level coverage first showing default `PortableToolContext` remains exhaustively assignable to the built-in host union, an unannotated `definePortableTool` callback sees `ctx.host` as exactly the built-in union, a custom-host tool can observe a custom host string, and host types are exported from the root entrypoint.
- Introduce `PortableToolBuiltInHost` and generic `PortableToolHost<TExtension extends string = never>` types, then thread the generic through `PortableToolContext`, `PortableTool`, `definePortableTool`, and `executePortableTool`.
- Update installed-package declaration smoke to import and assign the host types.

**Execution note:** Types-first and test-first. Add type-level assertions/imports before implementation passes.

**Patterns to follow:**
- Existing TypeBox-inferred arg test in `packages/pi-portable-tools/src/core/execute-tool.test.ts`
- Installed SDK declaration fixture in `scripts/smoke-pi-text-utils-package.mjs`

**Test scenarios:**
- Existing `"pi"`, `"mcp"`, and `"test"` hosts remain valid.
- Default `PortableToolContext["host"]` remains a closed built-in union for exhaustive consumer switches.
- An unannotated `definePortableTool({... execute(args, ctx) { ... } })` callback sees `ctx.host` as exactly `"pi" | "mcp" | "test"`, not `string`.
- A custom host string such as `"custom-adapter"` compiles only when the tool/context opts into that host generic and flows through `executePortableTool` to the tool handler.
- Root package runtime exports remain unchanged because host types are type-only.

**Verification:**
- `npm run typecheck`
- `npm test`
- `npm run mcp:text-utils:package-smoke`

---

## System-Wide Impact

- **Interaction graph:** Package metadata and type changes affect SDK consumers at install, import, and compile time; pi/MCP runtime call chains should remain unchanged.
- **Error propagation:** No error behavior changes are intended. Existing pi throw and MCP `isError` mapping must remain intact.
- **State lifecycle risks:** None; no persistent state is touched.
- **API surface parity:** Root, pi, and MCP subpath exports must remain stable. The public type additions are `PortableToolBuiltInHost` and `PortableToolHost`; both are type-only.
- **Integration coverage:** Package-smoke remains the integration proof for packed install behavior and declaration usability.
- **Unchanged invariants:** `registerMcpTools` remains absent; TypeBox remains the schema source; the SDK remains ESM-only.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `sideEffects: false` could be wrong if future modules gain import-time behavior | Add it only after confirming current published modules are import-passive; future side-effect modules must update the field |
| Disabling SDK source maps may reduce debugging convenience | Acceptable for this tiny package; can be revisited by publishing maps and sources together later |
| Extensible host type could be widened too far or break exhaustive switches | Preserve the default built-in union, add an unannotated-callback type assertion, and require custom adapters to opt into a host generic |
| Metadata changes may not be exercised by local workspace imports | Keep package-smoke and prepack verification in the acceptance path |

---

## Verification Plan

- `npm run typecheck`
- `npm test`
- `npm run prepack --workspace @feniix/pi-portable-tools`
- `npm pack --workspace @feniix/pi-portable-tools --dry-run --json`
- `npm run mcp:text-utils:package-smoke`

---

## Rollout Notes

- No npm publish occurs in this branch.
- Consumers should see no runtime behavior change.
- Consumers can start using `PortableToolHost` for custom adapter typing after release.
- Review feedback resolution: bump `@feniix/pi-portable-tools` to `0.2.0` and update the `pi-text-utils` dependency to match so the Node `>=20` contract tightening and type-surface additions are semver-visible before any future publish.
