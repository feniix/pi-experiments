import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { EffectiveConfigStatus } from "./storage.js";
import { isRecord } from "./types.js";

export const DEFAULT_MAX_BYTES = 51200;
export const DEFAULT_MAX_LINES = 2000;

type ConfigSource = "flag" | "env" | "project_settings" | "global_settings" | "config_file" | "default";

export interface SeqThinkConfig {
  storageDir?: string;
  maxBytes?: number;
  maxLines?: number;
}

export interface SeqThinkConfigWithSources {
  config: SeqThinkConfig;
  sources: Partial<Record<keyof SeqThinkConfig, ConfigSource>>;
}

export interface ResolveEffectiveConfigInput {
  flags?: {
    storageDir?: unknown;
    maxBytes?: unknown;
    maxLines?: unknown;
  };
  env?: Record<string, string | undefined>;
  config?: SeqThinkConfigWithSources | null;
  cwd?: string;
  homeDir?: string;
}

export interface ConfigLoadContext {
  env?: Record<string, string | undefined>;
  cwd?: string;
  homeDir?: string;
}

export function getHomeDir(env: Record<string, string | undefined> = process.env): string {
  return env.HOME || homedir();
}

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function resolveConfigPath(configPath: string, context: ConfigLoadContext = {}): string {
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();
  const homeDir = context.homeDir ?? getHomeDir(env);
  const trimmed = configPath.trim();
  if (trimmed.startsWith("~/")) {
    return join(homeDir, trimmed.slice(2));
  }
  if (trimmed.startsWith("~")) {
    return join(homeDir, trimmed.slice(1));
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(cwd, trimmed);
}

export function parseConfig(raw: unknown, pathHint: string): SeqThinkConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Sequential Thinking config at ${pathHint}: expected an object.`);
  }
  return {
    storageDir: normalizeString(raw.storageDir),
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function sourceForConfig(config: SeqThinkConfig, source: ConfigSource): SeqThinkConfigWithSources {
  const sources: SeqThinkConfigWithSources["sources"] = {};
  if (config.storageDir !== undefined) sources.storageDir = source;
  if (config.maxBytes !== undefined) sources.maxBytes = source;
  if (config.maxLines !== undefined) sources.maxLines = source;
  return { config, sources };
}

function loadSettingsConfig(
  path: string,
  source: "project_settings" | "global_settings",
): SeqThinkConfigWithSources | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const config = parsed["pi-sequential-thinking"];
    if (!isRecord(config)) {
      return null;
    }
    return sourceForConfig(parseConfig(config, path), source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(context: ConfigLoadContext = {}): void {
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();
  const homeDir = context.homeDir ?? getHomeDir(env);
  const legacyPaths = [
    join(cwd, ".pi", "extensions", "sequential-thinking.json"),
    join(homeDir, ".pi", "agent", "extensions", "sequential-thinking.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-sequential-thinking] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-sequential-thinking", or pass --seq-think-config-file / SEQ_THINK_CONFIG_FILE explicitly.`,
      );
    }
  }
}

function loadConfigFileWithSources(path: string): SeqThinkConfigWithSources | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return sourceForConfig(parseConfig(parsed, path), "config_file");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function mergeConfigWithSources(
  globalConfig: SeqThinkConfigWithSources | null,
  projectConfig: SeqThinkConfigWithSources | null,
): SeqThinkConfigWithSources {
  const config: SeqThinkConfig = {
    storageDir: projectConfig?.config.storageDir ?? globalConfig?.config.storageDir,
    maxBytes: projectConfig?.config.maxBytes ?? globalConfig?.config.maxBytes,
    maxLines: projectConfig?.config.maxLines ?? globalConfig?.config.maxLines,
  };
  return {
    config,
    sources: {
      storageDir: projectConfig?.sources.storageDir ?? globalConfig?.sources.storageDir,
      maxBytes: projectConfig?.sources.maxBytes ?? globalConfig?.sources.maxBytes,
      maxLines: projectConfig?.sources.maxLines ?? globalConfig?.sources.maxLines,
    },
  };
}

export function loadConfigWithSources(
  configPath: string | undefined,
  context: ConfigLoadContext = {},
): SeqThinkConfigWithSources | null {
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();
  const homeDir = context.homeDir ?? getHomeDir(env);
  const envConfigFile = env.SEQ_THINK_CONFIG_FILE;
  const legacyEnvConfig = env.SEQ_THINK_CONFIG;
  if (configPath) {
    return loadConfigFileWithSources(resolveConfigPath(configPath, { env, cwd, homeDir }));
  }
  if (envConfigFile) {
    return loadConfigFileWithSources(resolveConfigPath(envConfigFile, { env, cwd, homeDir }));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-sequential-thinking] SEQ_THINK_CONFIG is deprecated; use SEQ_THINK_CONFIG_FILE.");
    return loadConfigFileWithSources(resolveConfigPath(legacyEnvConfig, { env, cwd, homeDir }));
  }

  warnIgnoredLegacyConfigFiles({ env, cwd, homeDir });

  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  const globalSettingsPath = join(homeDir, ".pi", "agent", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath, "global_settings");
  const projectConfig = loadSettingsConfig(projectSettingsPath, "project_settings");

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return mergeConfigWithSources(globalConfig, projectConfig);
}

export function resolveEffectiveConfig(input: ResolveEffectiveConfigInput = {}): EffectiveConfigStatus {
  const flags = input.flags ?? {};
  const env = input.env ?? process.env;
  const config = input.config;
  const pathContext = { env, cwd: input.cwd, homeDir: input.homeDir };

  const flagStorageDir = normalizeString(flags.storageDir);
  const envStorageDir = normalizeString(env.MCP_STORAGE_DIR);
  const configStorageDir = config?.config.storageDir;

  const flagMaxBytes = normalizeNumber(flags.maxBytes);
  const envMaxBytes = normalizeNumber(env.SEQ_THINK_MAX_BYTES);
  const configMaxBytes = config?.config.maxBytes;

  const flagMaxLines = normalizeNumber(flags.maxLines);
  const envMaxLines = normalizeNumber(env.SEQ_THINK_MAX_LINES);
  const configMaxLines = config?.config.maxLines;

  const storageDir = flagStorageDir ?? envStorageDir ?? configStorageDir;

  return {
    storageDir: storageDir ? resolveConfigPath(storageDir, pathContext) : undefined,
    maxBytes: flagMaxBytes ?? envMaxBytes ?? configMaxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: flagMaxLines ?? envMaxLines ?? configMaxLines ?? DEFAULT_MAX_LINES,
    sources: {
      storageDir: flagStorageDir
        ? "flag"
        : envStorageDir
          ? "env"
          : configStorageDir
            ? (config?.sources.storageDir ?? "config_file")
            : "default",
      maxBytes: flagMaxBytes
        ? "flag"
        : envMaxBytes
          ? "env"
          : configMaxBytes
            ? (config?.sources.maxBytes ?? "config_file")
            : "default",
      maxLines: flagMaxLines
        ? "flag"
        : envMaxLines
          ? "env"
          : configMaxLines
            ? (config?.sources.maxLines ?? "config_file")
            : "default",
    },
  };
}
