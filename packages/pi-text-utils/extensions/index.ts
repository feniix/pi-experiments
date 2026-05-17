import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/pi-portable-tools/pi";
import { textUtilsTools } from "../src/tools/index.js";

export default function textUtilsExtension(pi: ExtensionAPI): void {
  registerPiTools(pi, textUtilsTools);
}
