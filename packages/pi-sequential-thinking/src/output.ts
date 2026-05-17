import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, normalizeNumber } from "./config.js";
import type { ValidationError } from "./types.js";

export interface SequentialThinkingToolDetails {
  tool: string;
  truncated: boolean;
  truncation?: {
    truncatedBy: "lines" | "bytes" | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    maxLines: number;
    maxBytes: number;
  };
  tempFile?: string;
  error?: string;
  validationErrors?: ValidationError[];
}

interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
  firstLineExceedsLimit: boolean;
}

export function toJsonString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function truncateByBytes(text: string, maxBytes: number): string {
  let output = "";
  let used = 0;
  for (const char of text) {
    const charBytes = byteLength(char);
    if (used + charBytes > maxBytes) break;
    output += char;
    used += charBytes;
  }
  return output;
}

export function truncateHead(
  text: string,
  limits: { maxLines?: number; maxBytes?: number },
): TruncationResult {
  const maxLines = Math.max(1, Math.floor(limits.maxLines ?? DEFAULT_MAX_LINES));
  const maxBytes = Math.max(1, Math.floor(limits.maxBytes ?? DEFAULT_MAX_BYTES));
  const lines = text.split("\n");
  const totalLines = lines.length;
  const totalBytes = byteLength(text);

  let content = lines.slice(0, maxLines).join("\n");
  let truncatedBy: "lines" | "bytes" | null = totalLines > maxLines ? "lines" : null;

  if (byteLength(content) > maxBytes) {
    content = truncateByBytes(content, maxBytes);
    truncatedBy = "bytes";
  }

  const outputBytes = byteLength(content);
  const outputLines = content.length === 0 ? 0 : content.split("\n").length;

  return {
    content,
    truncated: truncatedBy !== null || outputBytes < totalBytes,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes,
    maxLines,
    maxBytes,
    firstLineExceedsLimit: lines.length > 0 && byteLength(lines[0]) > maxBytes,
  };
}

export function formatToolOutput(
  toolName: string,
  result: unknown,
  limits: { maxBytes?: number; maxLines?: number },
): { text: string; details: SequentialThinkingToolDetails } {
  const rawText = toJsonString(result);
  const truncation = truncateHead(rawText, {
    maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let tempFile: string | undefined;

  if (truncation.truncated) {
    tempFile = writeTempFile(toolName, rawText);
    const tempSuffix = tempFile
      ? `Full output saved to: ${tempFile}`
      : "Full output unavailable (could not write overflow file)";
    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${tempSuffix}]`;
  }

  if (truncation.firstLineExceedsLimit && rawText.length > 0) {
    text =
      `[First line exceeded ${formatSize(truncation.maxBytes)} limit. Full output saved to: ${tempFile ?? "N/A"}]\n` +
      text;
  }

  return {
    text,
    details: {
      tool: toolName,
      truncated: truncation.truncated,
      truncation: {
        truncatedBy: truncation.truncatedBy,
        totalLines: truncation.totalLines,
        totalBytes: truncation.totalBytes,
        outputLines: truncation.outputLines,
        outputBytes: truncation.outputBytes,
        maxLines: truncation.maxLines,
        maxBytes: truncation.maxBytes,
      },
      tempFile,
    },
  };
}

export function writeTempFile(toolName: string, content: string): string | undefined {
  const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
  const filename = `pi-seq-think-${safeName}-${Date.now()}.txt`;
  const filePath = join(tmpdir(), filename);
  try {
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Could not write truncation overflow file: ${message}`);
    return undefined;
  }
}

export function splitParams(params: Record<string, unknown>): {
  toolArgs: Record<string, unknown>;
  requestedLimits: { maxBytes?: number; maxLines?: number };
} {
  const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
    piMaxBytes?: unknown;
    piMaxLines?: unknown;
  };
  return {
    toolArgs: rest,
    requestedLimits: {
      maxBytes: normalizeNumber(piMaxBytes),
      maxLines: normalizeNumber(piMaxLines),
    },
  };
}

export function resolveEffectiveLimits(
  requested: { maxBytes?: number; maxLines?: number },
  maxAllowed: { maxBytes: number; maxLines: number },
): { maxBytes: number; maxLines: number } {
  const requestedBytes = requested.maxBytes ?? maxAllowed.maxBytes;
  const requestedLines = requested.maxLines ?? maxAllowed.maxLines;
  return {
    maxBytes: Math.min(requestedBytes, maxAllowed.maxBytes),
    maxLines: Math.min(requestedLines, maxAllowed.maxLines),
  };
}
