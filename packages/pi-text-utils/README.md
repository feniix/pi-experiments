# pi-text-utils

Tiny experiment proving one portable tool definition can be exposed as both:

- a native pi extension tool set; and
- an MCP stdio server tool set.

## Tools

- `text_transform` — uppercase, lowercase, slugify, or reverse text.
- `text_stats` — count characters, words, and lines.

## pi extension

The pi package entrypoint is:

```json
{
  "pi": {
    "extensions": ["./extensions/index.ts"]
  }
}
```

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

## MCP test scripts

Run the automated stdio smoke test:

```bash
npm run mcp:text-utils:smoke
```

Call one MCP tool manually and print its raw result:

```bash
npm run mcp:text-utils:call -- text_transform '{"text":"Hello MCP","operation":"reverse"}'
npm run mcp:text-utils:call -- text_stats '{"text":"one two\nthree"}'
```

The implementation intentionally keeps tool logic in `src/tools/*` and host glue in `src/adapters/*` so the adapter pieces can later be extracted into a generalized SDK.
