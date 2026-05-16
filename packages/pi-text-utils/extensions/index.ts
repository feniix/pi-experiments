import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "../src/adapters/pi.js";
import { textUtilsTools } from "../src/tools/index.js";

export default function textUtilsExtension(pi: ExtensionAPI): void {
  registerPiTools(pi, textUtilsTools);
}
