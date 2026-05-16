import { textStatsTool } from "./text-stats.js";
import { textTransformTool } from "./text-transform.js";

export const textUtilsTools = [textTransformTool, textStatsTool] as const;

export { textStatsTool, textTransformTool };
