import { definePortableTool } from "@feniix/pi-portable-tools";
import { Type, type Static } from "typebox";

export const textStatsParams = Type.Object({
  text: Type.String({ description: "Text to inspect." }),
});

export type TextStatsParams = Static<typeof textStatsParams>;

export const textStatsTool = definePortableTool({
  name: "text_stats",
  title: "Text Stats",
  description: "Count characters, words, and lines in text.",
  parameters: textStatsParams,
  execute(args) {
    const lines = args.text.length === 0 ? 0 : args.text.split(/\r\n|\r|\n/).length;
    const words = args.text.trim().length === 0 ? 0 : args.text.trim().split(/\s+/).length;
    const characters = args.text.length;

    const structuredContent = {
      characters,
      words,
      lines,
      isEmpty: args.text.length === 0,
    };

    return {
      text: JSON.stringify(structuredContent, null, 2),
      structuredContent,
    };
  },
});
