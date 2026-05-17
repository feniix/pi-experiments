# @feniix/pi-sequential-thinking

Sequential Thinking tools for [pi](https://pi.dev/) and MCP. This package ports the behavior of `@feniix/pi-sequential-thinking` from `../pi-extensions` into this repo's `@feniix/pi-portable-tools` experiment so the same tool definitions can run as both a native pi extension and an MCP stdio server.

> Experimental incubation package. It is intended for this repo's short-lived pi/MCP portability experiments and is not published by this branch.

## Features

- **Process Thought** (`process_thought`): Record and analyze sequential thoughts with stage metadata.
- **Session-Scoped History**: Use the default session or named `session_id` values for independent thinking threads.
- **Get History** (`get_thinking_history`): Read bounded, paginated session history.
- **Get Status** (`get_thinking_status`): Inspect content-free storage/config diagnostics and state fingerprints.
- **Generate Summary** (`generate_summary`): Summarize one thinking session.
- **Clear History** (`clear_history`): Reset one thinking session.
- **Export/Import Session** (`export_session`, `import_session`): Move session JSON files with validation and receipts.
- **MCP-Compatible Aliases**: Accept snake_case fields and camelCase aliases such as `thoughtNumber` and `totalThoughts`.
- **Dynamic Depth**: If `thought_number` exceeds `total_thoughts`, the incoming thought is normalized to the larger total.
- **Shared Runtime**: pi and MCP use the same portable tool definitions.

## pi usage

```bash
pi -e npm:@feniix/pi-sequential-thinking
```

The package registers one native pi extension:

```json
{
  "pi": {
    "extensions": ["./dist/extensions/index.js"]
  }
}
```

## MCP usage

After building or installing the package, run the stdio MCP server:

```bash
pi-sequential-thinking-mcp
```

In this repo, the smoke test runs the built server with:

```bash
npm run mcp:sequential-thinking:smoke
```

## Configuration

### Default storage

Default session:

```text
~/.mcp_sequential_thinking/current_session.json
```

Named sessions:

```text
~/.mcp_sequential_thinking/sessions/<session_id>.json
```

`default` is reserved as the default-session label and cannot be used as a named `session_id`.

### Environment variables

```bash
export MCP_STORAGE_DIR="~/.my-thinking-sessions"
export SEQ_THINK_MAX_BYTES=102400
export SEQ_THINK_MAX_LINES=5000
```

### pi settings files

Use pi's standard settings locations:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Under the `pi-sequential-thinking` key:

```json
{
  "pi-sequential-thinking": {
    "storageDir": null,
    "maxBytes": 51200,
    "maxLines": 2000
  }
}
```

Per-field precedence is:

1. pi CLI flags, when running as a pi extension
2. environment variables
3. project settings
4. global settings
5. built-in defaults

Custom config file discovery uses `--seq-think-config-file` / `SEQ_THINK_CONFIG_FILE`; deprecated `--seq-think-config` / `SEQ_THINK_CONFIG` remain accepted for source-package compatibility.

## Tools

### `process_thought`

| Parameter | Type | Required | Description |
|---|---:|:---:|---|
| `thought` | string | yes | The content of your thought |
| `thought_number` / `thoughtNumber` | integer | yes | Position in sequence, starting at 1 |
| `total_thoughts` / `totalThoughts` | integer | yes | Estimated total thoughts; normalized upward for dynamic depth |
| `next_thought_needed` / `nextThoughtNeeded` | boolean | yes | Whether more thoughts follow |
| `stage` | string | yes | One of: `Problem Definition`, `Research`, `Analysis`, `Synthesis`, `Conclusion` |
| `session_id` / `sessionId` | string | no | Named session to write; omit for default |
| `tags` | string[] | no | Keywords or categories |
| `axioms_used` / `axiomsUsed` | string[] | no | Principles applied |
| `assumptions_challenged` / `assumptionsChallenged` | string[] | no | Assumptions questioned |

Example:

```json
{
  "thought": "Compare storage options before choosing one.",
  "thoughtNumber": 1,
  "totalThoughts": 3,
  "nextThoughtNeeded": true,
  "stage": "Analysis",
  "session_id": "architecture-review"
}
```

### `get_thinking_history`

| Parameter | Type | Default | Description |
|---|---:|---:|---|
| `session_id` / `sessionId` | string | default | Session to read |
| `limit` | integer | `20` | Maximum thoughts to return, capped at `100` |
| `offset` | integer | `0` | Number of thoughts to skip |
| `include_full_thoughts` / `includeFullThoughts` | boolean | `true` | Set `false` to return snippets instead of full thought text |

### `get_thinking_status`

Returns content-free diagnostics: session counts, storage writability, backup file names, effective config source labels, and current state fingerprints. Home-directory paths are redacted with `~` where possible.

### `generate_summary`

Generate a summary for one session. Accepts optional `session_id` / `sessionId`.

### `clear_history`

Clear one session. Accepts optional `session_id` / `sessionId` and returns a mutation receipt.

### `export_session`

Export one session to a JSON file. `file_path` may be absolute or repo-relative; parent directories are created automatically. Directory targets and final-path symlinks are rejected.

### `import_session`

Import a JSON session file. Explicit `session_id` / `sessionId` wins over embedded session metadata. Imports reject directories, final-path symlinks, malformed top-level records, and files over 10 MiB.

### `sequential_think`

Compatibility helper that generates a staged sequence for a topic and writes it to the selected session.

## Thinking stages

1. **Problem Definition** — Define and scope the problem
2. **Research** — Gather information and context
3. **Analysis** — Examine and evaluate the evidence
4. **Synthesis** — Combine insights into a coherent view
5. **Conclusion** — Draw final conclusions and recommendations

## Privacy and storage notes

- Storage is local plaintext JSON.
- `process_thought`, `get_thinking_history`, `generate_summary`, `export_session`, `import_session`, and `sequential_think` are content-bearing tools.
- `get_thinking_status` and mutation receipts are designed to avoid thought text, tags, axioms, and assumptions.
- The storage layer assumes one active process per storage directory. Add locking before using a shared directory with multiple writers.

## Requirements

- Node.js `>=20`
- pi v0.51.0 or later for native extension usage

## License

MIT
