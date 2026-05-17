import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getHomeDir, loadConfigWithSources, resolveEffectiveConfig } from "../src/config.js";
import { registerSequentialThinkingPiTools } from "../src/pi-registration.js";
import { ThoughtStorage } from "../src/storage.js";
import { createSequentialThinkingTools } from "../src/tools.js";

export { ThoughtStorage } from "../src/storage.js";

export default function sequentialThinking(pi: ExtensionAPI): void {
  pi.registerFlag("--seq-think-storage-dir", {
    description: "Storage directory for thought sessions.",
    type: "string",
  });
  pi.registerFlag("--seq-think-config-file", {
    description: "Path to custom JSON config file (overrides settings.json lookup).",
    type: "string",
  });
  pi.registerFlag("--seq-think-config", {
    description: "Deprecated alias for --seq-think-config-file.",
    type: "string",
  });
  pi.registerFlag("--seq-think-max-bytes", {
    description: "Max bytes to keep from tool output (default: 51200).",
    type: "string",
  });
  pi.registerFlag("--seq-think-max-lines", {
    description: "Max lines to keep from tool output (default: 2000).",
    type: "string",
  });

  const getConfiguredFile = (): string | undefined => {
    const configFileFlag = pi.getFlag("--seq-think-config-file");
    const legacyConfigFlag = pi.getFlag("--seq-think-config");
    if (typeof configFileFlag !== "string" && typeof legacyConfigFlag === "string") {
      console.warn("[pi-sequential-thinking] --seq-think-config is deprecated; use --seq-think-config-file.");
    }
    return typeof configFileFlag === "string"
      ? configFileFlag
      : typeof legacyConfigFlag === "string"
        ? legacyConfigFlag
        : undefined;
  };

  const getEffectiveConfig = () => {
    const config = loadConfigWithSources(getConfiguredFile());
    return resolveEffectiveConfig({
      flags: {
        storageDir: pi.getFlag("--seq-think-storage-dir"),
        maxBytes: pi.getFlag("--seq-think-max-bytes"),
        maxLines: pi.getFlag("--seq-think-max-lines"),
      },
      env: process.env,
      config,
    });
  };

  const initialConfig = getEffectiveConfig();
  const storage = new ThoughtStorage(initialConfig.storageDir);
  const tools = createSequentialThinkingTools({
    storage,
    getMaxLimits() {
      const config = getEffectiveConfig();
      return { maxBytes: config.maxBytes, maxLines: config.maxLines };
    },
    getEffectiveConfig() {
      const config = getEffectiveConfig();
      return {
        ...config,
        storageDir: initialConfig.storageDir ?? join(getHomeDir(), ".mcp_sequential_thinking"),
        sources: { ...config.sources, storageDir: initialConfig.sources.storageDir },
      };
    },
  });

  registerSequentialThinkingPiTools(pi, tools);
}
