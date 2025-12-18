// src/lib/research/openaiSchema.ts

export const OpenAIResearchJsonSchema = {
  name: "research_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["recommendation", "rationale", "risks", "unknowns", "confidence"],
    properties: {
      recommendation: { type: "string" },
      rationale: { type: "string" },
      risks: {
        type: "array",
        items: { type: "string" },
      },
      unknowns: {
        type: "array",
        items: { type: "string" },
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
    },
  },
} as const;
