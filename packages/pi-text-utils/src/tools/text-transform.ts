import { Type, type Static } from "typebox";
import { definePortableTool } from "../portable/define-tool.js";

export const textTransformParams = Type.Object({
  text: Type.String({ description: "Text to transform." }),
  operation: Type.Union(
    [Type.Literal("uppercase"), Type.Literal("lowercase"), Type.Literal("slugify"), Type.Literal("reverse")],
    { description: "Transformation to apply." },
  ),
});

export type TextTransformParams = Static<typeof textTransformParams>;

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const textTransformTool = definePortableTool({
  name: "text_transform",
  title: "Text Transform",
  description: "Transform text using uppercase, lowercase, slugify, or reverse operations.",
  parameters: textTransformParams,
  execute(args) {
    let output: string;

    switch (args.operation) {
      case "uppercase":
        output = args.text.toUpperCase();
        break;
      case "lowercase":
        output = args.text.toLowerCase();
        break;
      case "slugify":
        output = slugify(args.text);
        break;
      case "reverse":
        output = [...args.text].reverse().join("");
        break;
    }

    return {
      text: output,
      structuredContent: {
        input: args.text,
        output,
        operation: args.operation,
        inputLength: args.text.length,
        outputLength: output.length,
      },
    };
  },
});
