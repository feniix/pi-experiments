# pi-text-utils

Tiny experiment proving one portable tool definition can be exposed as both:

- a native pi extension tool set; and
- an MCP stdio server tool set.

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

The source extension remains at `extensions/index.ts` for local development.

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

Run the package smoke test, which packs the package, installs it into a clean temp project, and calls the installed MCP bin:

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

As of `0.2.0`, portable validation failures are host-native errors in pi: the pi adapter rejects with `PortableToolExecutionError`. MCP returns the equivalent tool result with `isError: true`. The parity script normalizes both paths to verify they remain behaviorally equivalent.

The implementation intentionally keeps tool logic in `src/tools/*` and host glue in `src/adapters/*` so the adapter pieces can later be extracted into a generalized SDK.
