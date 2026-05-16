---
title: "Dual pi/MCP Portable Tool SDK Experiment"
prd: "N/A - exploratory architecture spike"
date: 2026-05-16
author: "pi"
status: Draft
---

# Plan: Dual pi/MCP Portable Tool SDK Experiment

## Source

- **PRD**: N/A - exploratory architecture spike from conversation about issue `feniix/pi-extensions#99`
- **Date**: 2026-05-16
- **Author**: pi

## Architecture Overview

Build a tiny generalized experiment in this repo that proves one tool implementation can be registered in two host environments: as a native pi extension tool and as an MCP server tool. The goal is not to adapt one specific extension, but to discover a repeatable SDK shape for future pi packages.

The core architectural move is to define a host-neutral `PortableTool` contract. A portable tool owns its name, title, description, TypeBox parameter schema, and pure execution handler. Host adapters then translate that one definition into pi's `pi.registerTool(...)` API and MCP's `McpServer.registerTool(...)` API.

The first proof should use a deliberately boring tool, such as `echo_plus` or `add_numbers`, so the experiment tests the adapter boundary rather than domain complexity. Once that works, the same contract can be evaluated against more realistic tools with storage, progress, errors, and structured results.

## Components

### Portable Tool Core

**Purpose**: Define the minimal host-neutral contract developers author against.

**Key Details**:

- Exposes `definePortableTool(...)` and `PortableTool` types.
- Uses TypeBox as the schema source of truth because pi already accepts TypeBox and MCP accepts JSON Schema.
- Keeps handlers free of pi or MCP imports.
- Defines a normalized result shape: text content, optional structured data, optional details, and optional error metadata.

**ADR Reference**: Candidate - whether TypeBox should be the canonical schema format.

### pi Adapter

**Purpose**: Register portable tools as native pi extension tools.

**Key Details**:

- Converts `PortableTool` metadata into `pi.registerTool({ name, label, description, parameters, execute })`.
- Maps portable text/structured results into pi tool `content` and `details`.
- Optionally maps portable progress events to pi `onUpdate`.
- Does not add MCP concepts to pi extension code.

**ADR Reference**: None - straightforward adapter.

### MCP Adapter

**Purpose**: Register portable tools as MCP server tools.

**Key Details**:

- Converts TypeBox schemas to MCP-compatible schemas using MCP SDK JSON Schema support, ideally `fromJsonSchema(...)` with a validator.
- Maps portable results into MCP `content`, optional `structuredContent`, and `isError`.
- Starts with stdio transport for local MCP client compatibility.
- Keeps transport selection separate from tool registration.

**ADR Reference**: Candidate - MCP SDK version and schema validation bridge.

### Tiny Example Package

**Purpose**: Prove the developer experience with the smallest possible real tool.

**Key Details**:

- Provides one or two example portable tools.
- Provides a pi extension entrypoint that calls `registerPiTools(pi, tools)`.
- Provides an MCP stdio entrypoint that calls `createMcpServer(tools)`.
- Includes tests that call the core handler directly and adapters enough to catch registration drift.

**ADR Reference**: None - experiment fixture.

## Proposed Minimal API Sketch

```ts
import type { Static, TSchema } from "typebox";

export interface PortableToolResult {
  text: string;
  structuredContent?: Record<string, unknown>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface PortableToolContext {
  signal?: AbortSignal;
  progress?: (update: PortableToolResult) => void;
  host: "pi" | "mcp" | "test";
}

export interface PortableTool<TParams extends TSchema> {
  name: string;
  title: string;
  description: string;
  parameters: TParams;
  execute(args: Static<TParams>, ctx: PortableToolContext): Promise<PortableToolResult> | PortableToolResult;
}

export function definePortableTool<TParams extends TSchema>(tool: PortableTool<TParams>): PortableTool<TParams> {
  return tool;
}
```

Example tool:

```ts
export const echoPlusTool = definePortableTool({
  name: "echo_plus",
  title: "Echo Plus",
  description: "Echo text with optional uppercase transformation.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo." }),
    uppercase: Type.Optional(Type.Boolean({ description: "Whether to uppercase the text." })),
  }),
  execute(args) {
    const output = args.uppercase ? args.text.toUpperCase() : args.text;
    return {
      text: output,
      structuredContent: { output, length: output.length },
    };
  },
});
```

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope |
|-------|-----------|--------------|-----------------|
| 1 | Project scaffold | None | S |
| 2 | Portable Tool Core | Phase 1 | S |
| 3 | Tiny example tool | Phase 2 | S |
| 4 | pi adapter and extension entrypoint | Phase 2, 3 | S |
| 5 | MCP adapter and stdio entrypoint | Phase 2, 3 | M |
| 6 | Verification scripts/tests | Phase 4, 5 | M |
| 7 | Developer notes | Phase 6 | S |

## Verification Plan

- Run the example tool directly through the portable handler in a unit test.
- Load the pi extension locally with `pi -e ./path/to/extension.ts` and call the tool from pi.
- Run the MCP stdio server and inspect it with an MCP-compatible client or SDK test harness.
- Confirm the same TypeBox schema is exposed by both adapters.
- Confirm no domain code imports pi or MCP packages.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MCP SDK schema API differs from researched v2 docs or installed package version | Medium | Medium | Start with the installed `@modelcontextprotocol/sdk` version and keep MCP adapter isolated. |
| TypeBox schemas use constructs some MCP hosts reject | Medium | Medium | Keep initial schemas simple: object, string, number, boolean, arrays, required fields. Document compatibility subset. |
| Adapter hides host-specific differences too aggressively | Medium | High | Keep the core contract small and expose explicit host capabilities through `PortableToolContext`. |
| pi-only features leak into core | Medium | High | Enforce dependency direction: core imports no pi or MCP packages. |
| The proof works for trivial tools but fails for stateful tools | Medium | Medium | Treat state/storage as the second experiment after proving stateless tools. |

## Open Questions

- Should the generalized SDK live as a standalone package later, or remain an internal pattern until two real packages use it?
- Should `PortableToolResult.details` be pi-only, or should it map to MCP `structuredContent` when possible?
- Should the MCP adapter use high-level `McpServer.registerTool` or low-level `tools/list` and `tools/call` handlers for maximum TypeBox control?
- Should host capability checks be runtime flags on `ctx`, or separate optional adapter-specific hooks?

## ADR Index

Decisions surfaced by this plan:

| ADR | Title | Status |
|-----|-------|--------|
| TBD | Use TypeBox as the canonical portable tool schema format | Candidate |
| TBD | Use adapter packages instead of one-off pi-to-MCP bridges | Candidate |
| TBD | Use MCP high-level server API vs low-level protocol handlers | Candidate |
