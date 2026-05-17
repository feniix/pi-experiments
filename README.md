# pi-experiments

`pi-experiments` is a sandbox for short-lived experiments and incubations around pi packages, MCP integrations, coding-agent workflows, and agent-accessible tool design.

The repo exists to make small ideas concrete quickly: prototype a package, test an integration boundary, harden a workflow, document what was learned, and then either promote the idea elsewhere or delete/replace it.

## Experiment disclaimer

All code in this repository should be treated as experimental.

- APIs may change without notice.
- Packages may be renamed, removed, or replaced.
- Version numbers are useful for local packaging tests, not a stability promise unless a package is explicitly published and documented elsewhere.
- Implementations optimize for learning and validation before long-term maintenance.
- If an experiment graduates, expect it to move into a dedicated repository or receive a separate stabilization pass.

## Repository layout

```text
packages/   # experimental packages and proof fixtures
scripts/    # local build, smoke-test, packaging, and verification helpers
docs/       # architecture notes, plans, and experiment records
```

Package-specific usage lives inside each package directory. Start with the package README, `llms.txt`, or examples when present.

## Requirements

- Node.js 20 or newer
- npm workspaces

The workspace is ESM-first and uses TypeScript project references.

## Getting started

Install dependencies:

```bash
npm install
```

Build all packages from a clean `dist` state:

```bash
npm run build
```

Typecheck the workspace:

```bash
npm run typecheck
```

Run the test suite:

```bash
npm test
```

Clean generated package output:

```bash
npm run clean
```

## Working conventions

- Start with small, focused experiments; let framework-shaped code emerge only after a concrete proof fixture validates the need.
- Keep host-neutral logic separate from host adapters when testing portability.
- Validate package behavior with packed-install smoke tests when packaging is part of the experiment.
- Keep docs close to the experiment so future readers can understand the question being tested.
- Treat old plans and architecture notes as historical context, not necessarily current direction.
