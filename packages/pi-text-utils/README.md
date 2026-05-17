# pi-text-utils

Tiny fixture package proving one portable tool definition can be exposed as both:

- a native pi extension tool set; and
- an MCP stdio server tool set.

`pi-text-utils` now consumes `@feniix/bridgekit`; tool logic stays here while the reusable portable-tool contract and host adapters live in the SDK package.

## Tools

- `text_transform` — uppercase, lowercase, slugify, or reverse text.
- `text_stats` — count characters, words, and lines.

## pi extension

The packaged pi entrypoint is:

```json
{
  "pi": {
    "extensions": ["./dist/extensions/index.js"]
  }
}
```

The source extension remains at `extensions/index.ts` for local development and calls `registerPiTools` from `@feniix/bridgekit/pi`.

Build, then run locally with pi from this repo root:

```bash
npm run build
pi -e ./packages/pi-text-utils
```

## MCP server

After building, run the stdio MCP server:

```bash
npm run build
node packages/pi-text-utils/dist/src/mcp-server.js
```

Or use the root npm wrapper:

```bash
npm run mcp:text-utils:server
```

The server uses `runMcpStdioServer` from `@feniix/bridgekit/mcp`.

## pi prompt tests

After loading the package in pi, use these prompt templates to exercise the tools:

```text
/text-transform
/text-stats
/text-utils-combined
```

Each prompt is stored under `prompts/` and asks pi to call the registered tools.

## MCP test scripts

Run the automated stdio smoke test:

```bash
npm run mcp:text-utils:smoke
```

Run the package smoke test, which packs the SDK and this package, installs both into a clean temp project, verifies SDK subpath exports, and calls the installed MCP bin:

```bash
npm run mcp:text-utils:package-smoke
```

Call one MCP tool manually and print its raw result:

```bash
npm run mcp:text-utils:call -- text_transform '{"text":"Hello MCP","operation":"reverse"}'
npm run mcp:text-utils:call -- text_stats '{"text":"one two\nthree"}'
```

Compare pi-adapter execution against MCP stdio execution for the same valid calls and invalid portable-tool input:

```bash
npm run mcp:text-utils:parity
```

## Error behavior

As of `0.3.0`, reusable adapters live in `@feniix/bridgekit`. Portable validation failures are host-native errors in pi: the pi adapter rejects with `PortableToolExecutionError`. MCP returns the equivalent tool result with `isError: true`. The parity script normalizes both paths to verify they remain behaviorally equivalent.

## Migration note

The previous text-utils-local deep import `dist/src/adapters/mcp.js` exposed an experimental `registerMcpTools` helper. That helper was removed because it claimed high-level MCP SDK compatibility that was not exercised by production code. Use `@feniix/bridgekit/mcp` and its `createMcpServer` or `runMcpStdioServer` APIs instead.

## Local tarballs and release ordering

`@feniix/pi-text-utils` has a normal semver dependency on `@feniix/bridgekit` and bundles the SDK package in its tarball so local unpublished text-utils tarballs install cleanly on their own. `npm run mcp:text-utils:package-smoke` verifies both the single-tarball path and the explicit SDK + text-utils tarball path. For an npm release, publish `@feniix/bridgekit@0.2.0` before publishing `@feniix/pi-text-utils@0.3.1` so registry installs do not rely on the bundled fallback indefinitely.
