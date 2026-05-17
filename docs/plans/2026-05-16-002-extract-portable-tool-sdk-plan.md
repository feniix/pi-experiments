---
title: Extract Portable Tool SDK from pi-text-utils
type: refactor
status: active
date: 2026-05-16
---

# Extract Portable Tool SDK from pi-text-utils

## Summary

Extract the reusable portable-tool core and host adapters from `packages/pi-text-utils` into a new workspace package, then make `pi-text-utils` consume that SDK as its first real fixture. The same pass removes the misleading high-level MCP registration helper and keeps only the low-level MCP server path that is actually compatible with the installed SDK.

---

## Problem Frame

`pi-text-utils` proved that a single TypeBox-backed tool definition can serve both pi and MCP, but the reusable pieces still live inside the example package. One exported helper, `registerMcpTools`, also overstates compatibility with the installed high-level MCP API because the real production path uses low-level `tools/list` and `tools/call` handlers.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- “Next steps 1 and 2” means the two substantive follow-ups already identified: clean up MCP adapter honesty, then extract reusable SDK pieces.
- A single SDK package is sufficient for this iteration; splitting core, pi adapter, and MCP adapter into separate packages is deferred until a second consumer proves the need.
- The SDK package should publish import-isolated subpath exports so consumers can import only core, pi, or MCP entrypoints. True npm dependency isolation is deferred until/unless the SDK splits into separate core and host-adapter packages.

---

## Requirements

- R1. Remove or replace misleading `registerMcpTools` coverage so the public MCP adapter surface only claims behavior verified against the installed MCP SDK.
- R2. Create a reusable workspace package for portable tool definitions, validation/execution, pi adapter, and low-level MCP server adapter.
- R3. Update `packages/pi-text-utils` to consume the SDK package instead of local portable/adapters modules while preserving pi extension and MCP server behavior.
- R4. Preserve package/runtime dependency correctness: direct runtime imports are package dependencies, pi host remains an optional peer, packed installs work outside the monorepo.
- R5. Maintain parity and invalid-input behavior: pi throws `PortableToolExecutionError`, MCP returns `isError: true`, and the parity harness normalizes both host-specific shapes to the same portable validation details.
- R6. Implement with types-first and test-first development, including failing tests before moving code or changing behavior.

---

## Scope Boundaries

- Do not convert TypeBox schemas to Zod or reintroduce high-level `McpServer.registerTool` unless tests prove compatibility with the installed SDK.
- Do not add new text utility behavior or new tools.
- Do not publish packages to npm in this branch.
- Do not split into multiple SDK packages yet; use subpath exports inside one package.
- Do not add generic package-version discovery helpers; keep consumer package metadata lookup local to `pi-text-utils`.
- Do not generalize beyond stateless tool execution, progress callbacks, structured content, validation, and stdio MCP serving.

### Deferred to Follow-Up Work

- Decide whether the SDK should later split into `core`, `adapter-pi`, and `adapter-mcp` packages after at least one additional consumer exists.
- Add a second non-text consumer package to pressure-test SDK ergonomics.
- Revisit high-level MCP SDK registration only if the installed MCP SDK gains raw JSON Schema or TypeBox-compatible registration support.

---

## Context & Research

### Relevant Code and Patterns

- `packages/pi-text-utils/src/portable/define-tool.ts` defines the host-neutral `PortableTool` contract and result/context types.
- `packages/pi-text-utils/src/portable/execute-tool.ts` validates TypeBox arguments with `typebox/value` and returns portable validation errors.
- `packages/pi-text-utils/src/adapters/pi.ts` maps portable tools into `pi.registerTool`, including `PortableToolExecutionError` for portable failures.
- `packages/pi-text-utils/src/adapters/mcp.ts` uses low-level MCP `Server` request handlers for `tools/list` and `tools/call`; this is the honest installed-SDK path.
- `packages/pi-text-utils/src/adapters/mcp.test.ts` currently tests the misleading fake `registerTool` helper and should be rewritten around the real low-level server surface.
- Root workspace conventions use `packages/*`, project references in `tsconfig.json`, strict NodeNext TypeScript, and built-JS tests via `node --test packages/*/dist/**/*.test.js`.

### Institutional Learnings

- `docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md` says the core contract must stay host-neutral and TypeBox-backed while host concerns stay in adapters.
- `docs/plans/2026-05-16-001-fix-text-utils-hardening-parity-plan.md` records the packaging lesson: runtime imports belong in package `dependencies`, pi stays optional peer/type-only, and packed install smoke tests are required because workspace tests hide packaging mistakes.

### External References

- None used. Local code and installed SDK behavior are the authority for this refactor.

---

## Key Technical Decisions

- Create `packages/pi-portable-tools` named `@feniix/pi-portable-tools`: this name matches the pi ecosystem while still describing host-neutral portable tools.
- Export SDK entrypoints with subpaths: `@feniix/pi-portable-tools` for core, `@feniix/pi-portable-tools/pi` for pi adapter, and `@feniix/pi-portable-tools/mcp` for MCP adapter. These subpaths isolate runtime imports by entrypoint, not npm installation dependencies within the single package.
- Remove the high-level `registerMcpTools` helper instead of renaming it: no production code uses it, and retaining it encourages unsupported high-level MCP assumptions.
- Make the SDK MCP adapter accept server metadata from consumers: `pi-text-utils` should own its own server name/version/instructions rather than the SDK reading consumer package metadata implicitly.
- Keep package version discovery local to `pi-text-utils`; the SDK server factory should not hardcode consumer identity or provide a generic metadata helper in this refactor.
- Pack/install both SDK and `pi-text-utils` tarballs in the package smoke test so clean installs validate the transitive package relationship.

---

## Open Questions

### Resolved During Planning

- Should adapters move now or only core? Move core and both adapters now, because the target is a generalized SDK and the MCP honesty issue lives inside the adapter surface.
- Should `registerMcpTools` stay as experimental? No. Removing it makes the supported API smaller and honest.
- Should `pi-text-utils` depend on the SDK through `workspace:*`? No. Use a normal semver dependency matching the workspace package version so packed tarballs install outside the monorepo when the SDK tarball is installed too.

### Deferred to Implementation

- Exact placement of local `pi-text-utils` package-version lookup: keep it in `mcp-server.ts` unless readability clearly warrants a tiny `package-metadata.ts` module.

---

## Output Structure

    packages/pi-portable-tools/
      package.json
      README.md
      tsconfig.json
      src/
        index.ts
        pi.ts
        mcp.ts
        core/
          define-tool.ts
          execute-tool.ts
          execute-tool.test.ts
        adapters/
          pi.ts
          pi.test.ts
          mcp.ts
          mcp.test.ts
          mcp.integration.test.ts
    packages/pi-text-utils/
      src/
        tools/*.ts              # import core SDK
        package-metadata.ts     # optional; create only if metadata lookup is not kept in mcp-server.ts
        mcp-server.ts           # import MCP SDK adapter subpath and own stdio bin metadata
      extensions/index.ts       # import pi SDK adapter subpath

---

## Minimum Change Set

- Move the existing portable core plus pi/MCP adapters into one SDK package.
- Expose exactly three SDK runtime entrypoints: core/root, pi, and MCP, plus an optional `./package.json` metadata export.
- Delete local duplicate portable/adapter implementations from `pi-text-utils` after consumer imports move.
- Update only the package metadata, smoke scripts, and documentation needed to prove clean packed installs.
- Add clean-build and artifact-absence gates so removed APIs cannot survive in stale `dist` output.

---

## High-Level Technical Design

> *This illustrates the intended public API shape for review, not implementation choreography.*

```ts
export interface CreateMcpServerOptions {
  name: string;
  version: string;
  tools: readonly PortableTool<TSchema>[];
  instructions?: string;
}

export function createMcpServer(options: CreateMcpServerOptions): Server;
export function runMcpStdioServer(options: CreateMcpServerOptions): Promise<void>;
```

The SDK owns low-level MCP server creation, tool handlers, and stdio transport setup. Consumer packages own their server metadata and executable/bin entrypoints.

The SDK manifest should expose this package contract:

```json
{
  "name": "@feniix/pi-portable-tools",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/src/index.d.ts", "import": "./dist/src/index.js" },
    "./pi": { "types": "./dist/src/pi.d.ts", "import": "./dist/src/pi.js" },
    "./mcp": { "types": "./dist/src/mcp.d.ts", "import": "./dist/src/mcp.js" },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsc -b tsconfig.json",
    "prepack": "npm run build && node ../../scripts/verify-pi-portable-tools-dist.mjs"
  },
  "files": ["dist/**/*.js", "dist/**/*.d.ts", "!dist/**/*.test.*", "!dist/tsconfig.tsbuildinfo", "README.md"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "typebox": "^1.1.31"
  },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" },
  "peerDependenciesMeta": { "@earendil-works/pi-coding-agent": { "optional": true } }
}
```

`@feniix/pi-text-utils` should depend on `@feniix/pi-portable-tools` using a normal semver range satisfied by the local workspace version and packed SDK tarball, not `workspace:*` or `file:`. Its package build/prepack flow must build the SDK first from a clean state (for example with `tsc -b` project references or an explicit SDK build) rather than relying on stale SDK `dist` output.

---

## Implementation Units

### U1. Add SDK package scaffold and core portable contract

**Goal:** Create `@feniix/pi-portable-tools` with the portable tool types, TypeBox validation, and execution helper moved behind a package export.

**Requirements:** R2, R4, R6

**Dependencies:** None

**Files:**
- Create: `packages/pi-portable-tools/package.json`
- Create: `packages/pi-portable-tools/tsconfig.json`
- Create: `packages/pi-portable-tools/README.md`
- Create: `packages/pi-portable-tools/src/index.ts`
- Create: `packages/pi-portable-tools/src/core/define-tool.ts`
- Create: `packages/pi-portable-tools/src/core/execute-tool.ts`
- Create: `packages/pi-portable-tools/src/core/execute-tool.test.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/verify-pi-portable-tools-dist.mjs`

**Approach:**
- Write the SDK package manifest and public core export shape before moving implementation.
- Add a failing core test that defines a TypeBox-backed portable tool through the package entrypoint and verifies valid execution plus validation error shape.
- Add a root/package clean path before any source deletion so stale `dist` tests and declarations cannot survive refactors.
- Move/copy the current core implementation into SDK, then delete local core files from `pi-text-utils` after consumers are updated in later units.

**Execution note:** Test-first and types-first. Define exported types and tests before implementation passes.

**Patterns to follow:**
- `packages/pi-text-utils/package.json`
- `packages/pi-text-utils/tsconfig.json`
- `packages/pi-text-utils/src/portable/execute-tool.test.ts`

**Test scenarios:**
- Happy path: valid args execute a portable tool and return its structured result.
- Error path: invalid args return `isError: true` with `validationErrors` and do not call the tool handler.
- Type/API path: importing `definePortableTool`, `executePortableTool`, and portable types from `@feniix/pi-portable-tools` compiles.
- API contract path: root public symbols are snapshotted so no host adapter symbols leak from the root entrypoint.

**Verification:**
- `npm run build` builds the SDK package before `pi-text-utils` from a clean `dist` state.
- `npm test` includes SDK core tests from built JS.
- Core/root SDK declarations are emitted; full root/pi/MCP package export verification happens after U2 and U3 add the host entrypoints.

---

### U2. Extract and honest-ify the MCP adapter

**Goal:** Move the supported low-level MCP server adapter into the SDK and ensure the SDK does not introduce the unsupported high-level `registerMcpTools` helper.

**Requirements:** R1, R2, R4, R5, R6

**Dependencies:** U1

**Files:**
- Create: `packages/pi-portable-tools/src/mcp.ts`
- Create: `packages/pi-portable-tools/src/adapters/mcp.ts`
- Create: `packages/pi-portable-tools/src/adapters/mcp.test.ts`
- Create: `packages/pi-portable-tools/src/adapters/mcp.integration.test.ts`
- Modify: `packages/pi-portable-tools/package.json`
- Modify: `packages/pi-text-utils/src/mcp-server.ts` *(only after SDK MCP tests pass, if needed for compile wiring)*

**Approach:**
- Write SDK MCP tests against the explicit `CreateMcpServerOptions` API and the real `Client`/transport integration path.
- Do not provide or test a fake high-level registration API.
- Keep `pi-text-utils` rewiring and local adapter deletion primarily in U4; touch `pi-text-utils/src/mcp-server.ts` in this unit only if required to prove the SDK API compiles.

**Execution note:** Test-first. The first MCP adapter test should fail because the SDK package does not yet expose `@feniix/pi-portable-tools/mcp`.

**Patterns to follow:**
- `packages/pi-text-utils/src/adapters/mcp.ts`
- `packages/pi-text-utils/src/adapters/mcp.integration.test.ts`
- `scripts/compare-pi-text-utils-parity.mjs`

**Test scenarios:**
- Happy path: `createMcpServer` lists all portable tools with TypeBox JSON schemas.
- Happy path: MCP `tools/call` executes valid args and returns `content`, `structuredContent`, and `isError: false`.
- Error path: invalid args return `isError: true` with validation details and do not invoke the portable tool handler.
- Error path: unknown tool returns an MCP tool error result.
- API honesty path: no tests claim high-level `registerMcpTools` compatibility; README cleanup is completed in U4.

**Verification:**
- `npm test` passes SDK MCP unit/integration tests.
- Built SDK artifacts contain no `registerMcpTools` export.
- SDK public MCP symbols are snapshotted: `createMcpServer`, `runMcpStdioServer`, and `CreateMcpServerOptions` are exported; `registerMcpTools` is not.
- `npm run mcp:text-utils:smoke` passes after U4 rewiring through the extracted MCP adapter.
- `npm run mcp:text-utils:parity` still matches pi and MCP behavior after U4 rewiring.

---

### U3. Extract the pi adapter and error contract

**Goal:** Move pi registration and `PortableToolExecutionError` into the SDK pi subpath without yet rewiring the text-utils consumer.

**Requirements:** R2, R3, R4, R5, R6

**Dependencies:** U1

**Files:**
- Create: `packages/pi-portable-tools/src/pi.ts`
- Create: `packages/pi-portable-tools/src/adapters/pi.ts`
- Create: `packages/pi-portable-tools/src/adapters/pi.test.ts`
- Modify: `packages/pi-portable-tools/package.json`

**Approach:**
- Write SDK pi adapter tests around registration metadata, successful execution, progress mapping, and portable validation error rejection.
- Export `registerPiTools`, `PortableToolExecutionError`, and `isPortableToolExecutionError` from `@feniix/pi-portable-tools/pi`.
- Keep `pi-text-utils` rewiring and local adapter deletion in U4 so U3 does not create temporary consumer churn.

**Execution note:** Test-first. Add the SDK pi tests before moving the adapter implementation.

**Patterns to follow:**
- `packages/pi-text-utils/src/adapters/pi.ts`
- `packages/pi-text-utils/src/adapters/pi.test.ts`

**Test scenarios:**
- Happy path: registering tools maps `title` to pi `label` and keeps TypeBox parameters intact.
- Happy path: successful execution returns pi `content` and `details`.
- Progress path: portable progress updates become pi updates with text content and details.
- Error path: invalid args reject with `PortableToolExecutionError` whose `details.validationErrors` are preserved and whose underlying portable handler is not invoked.

**Verification:**
- `npm test` passes SDK pi tests.
- `npm run mcp:text-utils:parity` verifies pi error normalization through the SDK error guard after U4 rewiring.

---

### U4. Convert pi-text-utils to an SDK consumer and remove duplicate local SDK code

**Goal:** Make `@feniix/pi-text-utils` depend on `@feniix/pi-portable-tools`, remove local portable/adapter implementation duplication, and keep the package fixture working from packed tarballs.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `packages/pi-text-utils/package.json`
- Modify: `packages/pi-text-utils/README.md`
- Modify: `packages/pi-text-utils/src/tools/text-transform.ts`
- Modify: `packages/pi-text-utils/src/tools/text-stats.ts`
- Modify: `packages/pi-text-utils/src/tools/index.ts`
- Modify: `packages/pi-text-utils/src/mcp-server.ts`
- Modify: `packages/pi-text-utils/extensions/index.ts`
- Move/delete: `packages/pi-text-utils/src/adapters/mcp.integration.test.ts`
- Delete: `packages/pi-text-utils/src/adapters/mcp.test.ts`
- Delete: `packages/pi-text-utils/src/adapters/pi.test.ts`
- Modify: `scripts/compare-pi-text-utils-parity.mjs`
- Delete: `packages/pi-text-utils/src/portable/define-tool.ts`
- Delete: `packages/pi-text-utils/src/portable/execute-tool.ts`
- Delete: `packages/pi-text-utils/src/portable/execute-tool.test.ts`
- Delete: `packages/pi-text-utils/src/adapters/mcp.ts`
- Delete: `packages/pi-text-utils/src/adapters/pi.ts`
- Modify: `scripts/smoke-pi-text-utils-package.mjs`
- Modify: `scripts/verify-pi-text-utils-dist.mjs`

**Approach:**
- Update imports to package subpaths and keep text utility tests focused on domain behavior.
- Bump `@feniix/pi-text-utils` to `0.3.0` because local deep-import adapter files and `registerMcpTools` are removed; document migration to `@feniix/pi-portable-tools/mcp`.
- Change `pi-text-utils` build/prepack so `npm pack --workspace @feniix/pi-text-utils` builds the SDK dependency first instead of relying on stale SDK dist.
- Delete local portable and adapter implementation files from `pi-text-utils`; do not preserve compatibility re-exports unless a failing package entrypoint test proves one is required.
- Update package smoke to pack SDK first, pack text-utils second, and install both tarballs together in a clean temp project with no workspace links.
- Strengthen package smoke to drive the installed MCP bin over stdio: assert listed tool names, a valid call with `isError: false`, and an invalid call with `isError: true` plus validation details.
- Add verifier checks that `pi-text-utils` built/packed artifacts do not contain local portable implementation files or `registerMcpTools` symbols.

**Execution note:** Test-first/package-first. Update smoke and dist verifier expectations before making package metadata pass.

**Patterns to follow:**
- `scripts/smoke-pi-text-utils-package.mjs`
- `scripts/verify-pi-text-utils-dist.mjs`
- `packages/pi-text-utils/.npmignore`

**Test scenarios:**
- Integration: a clean temp install containing SDK and text-utils tarballs can run the installed `pi-text-utils-mcp` bin, list tools, successfully call `text_transform`, and return validation errors for invalid input.
- Integration: the installed text-utils pi extension loads and registers both tools using the SDK dependency.
- Packaging: SDK tarball contains core, pi, and MCP subpath dist files but no test files.
- Packaging: text-utils tarball no longer contains local SDK implementation tests or stale adapter implementation files.
- Packaging: smoke fails if `pi-text-utils` uses `workspace:*`, `file:`, or a semver range not satisfied by the packed SDK version.
- Type/API path: a temp NodeNext TypeScript consumer imports `@feniix/pi-portable-tools`, `@feniix/pi-portable-tools/pi`, and `@feniix/pi-portable-tools/mcp` from the packed SDK tarball; defines a TypeBox tool with inferred args; calls `executePortableTool`; constructs `CreateMcpServerOptions`; and narrows `PortableToolExecutionError` with `isPortableToolExecutionError` while accessing validation details.

**Verification:**
- `npm run mcp:text-utils:package-smoke` passes from clean temp install.
- `npm pack --dry-run --workspace @feniix/pi-portable-tools` succeeds.
- `npm pack --dry-run --workspace @feniix/pi-text-utils` succeeds.
- Grepping built and packed artifacts finds no `registerMcpTools` symbol.
- API contract snapshot confirms only the intended SDK public symbols are exported from root, pi, and MCP runtime entrypoints.

---

## System-Wide Impact

- **Interaction graph:** Tool definitions remain in `pi-text-utils/src/tools/*`; host entrypoints now call SDK adapters through package subpaths.
- **Error propagation:** Portable validation errors still originate from `executePortableTool`; pi converts them to `PortableToolExecutionError`; MCP returns tool-level `isError: true`.
- **State lifecycle risks:** No persistent state is introduced.
- **API surface parity:** Both pi and MCP paths must continue to expose the same tool names, schemas, text, and structured details.
- **Integration coverage:** Clean install smoke and MCP stdio parity are required because unit tests cannot prove package export/dependency correctness.
- **Unchanged invariants:** Text utility operations, prompt names, MCP bin name, and pi extension package entrypoint stay unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Workspace linking hides missing SDK package files | Pack and install both tarballs into a clean temp project. |
| TypeScript package subpath exports fail before build | Add project references and tsconfig path mappings; run `npm run typecheck` and clean-ish build paths during verification. |
| Removing `registerMcpTools` surprises hypothetical internal consumers | This repo has no production usage; README should document the supported low-level server API. |
| SDK package depends on host SDKs too eagerly | Keep imports isolated to subpath modules, accept single-package npm dependency installation for this iteration, and document future split as deferred follow-up. |
| Stale `dist` artifacts leak removed APIs | Add clean build behavior and verifier checks for absent local portable/adapters files and absent `registerMcpTools`. |
| Package dependency version drift breaks clean install | Use matching semver versions and package smoke that installs both tarballs together. |
| Removing local deep-import APIs breaks consumers silently | Bump `@feniix/pi-text-utils` to `0.3.0` and document the migration to SDK subpath imports. |

---

## Documentation / Operational Notes

- Update `packages/pi-text-utils/README.md` to explain it is now an example consumer of `@feniix/pi-portable-tools`.
- Add a concise `packages/pi-portable-tools/README.md` with core, pi, and MCP usage snippets.
- Keep the root scripts unchanged where possible so current verification commands remain valid.

---

## Sources & References

- Architecture plan: [docs/architecture/plan-dual-pi-mcp-tool-sdk-experiment.md](../architecture/plan-dual-pi-mcp-tool-sdk-experiment.md)
- Prior hardening plan: [docs/plans/2026-05-16-001-fix-text-utils-hardening-parity-plan.md](2026-05-16-001-fix-text-utils-hardening-parity-plan.md)
- Current core: [packages/pi-text-utils/src/portable/define-tool.ts](../../packages/pi-text-utils/src/portable/define-tool.ts)
- Current execution helper: [packages/pi-text-utils/src/portable/execute-tool.ts](../../packages/pi-text-utils/src/portable/execute-tool.ts)
- Current pi adapter: [packages/pi-text-utils/src/adapters/pi.ts](../../packages/pi-text-utils/src/adapters/pi.ts)
- Current MCP adapter: [packages/pi-text-utils/src/adapters/mcp.ts](../../packages/pi-text-utils/src/adapters/mcp.ts)
