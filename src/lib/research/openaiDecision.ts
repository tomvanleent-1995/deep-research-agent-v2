// src/lib/research/openaiDecision.ts

import { openai } from "@/config/openai";
import { OpenAIResearchJsonSchema } from "@/lib/research/openaiSchema";

export type OpenAIDecision = {
  recommendation: string;
  rationale: string;
  risks: string[];
  unknowns: string[];
  confidence: "low" | "medium" | "high";
};

function safeJsonParse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
    throw new Error("OpenAI returned non-JSON output.");
  }
}

export async function getDecisionFromOpenAI(params: {
  question: string;
  evidenceSummary: string;
}): Promise<OpenAIDecision> {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // ✅ Gebruik input als string => geen SDK typing drama
  const input = [
    "You are a decision support analyst.",
    "Return ONLY valid JSON that matches the provided schema. No prose.",
    "",
    `Decision question: ${params.question}`,
    "",
    "Evidence summary (scored sources + key takeaways):",
    params.evidenceSummary,
  ].join("\n");

  const resp = await openai.responses.create({
    model,
    input,
    text: {
      format: {
        type: "json_schema",
        name: OpenAIResearchJsonSchema.name,
        schema: OpenAIResearchJsonSchema.schema,
        strict: true,
      },
    },
  });

  const out = resp.output_text?.trim();
  if (!out) throw new Error("OpenAI response had no output_text.");

  const parsed = safeJsonParse<OpenAIDecision>(out);

  if (
    !parsed?.recommendation ||
    !parsed?.rationale ||
    !Array.isArray(parsed.risks) ||
    !Array.isArray(parsed.unknowns) ||
    !["low", "medium", "high"].includes(parsed.confidence)
  ) {
    throw new Error("OpenAI JSON did not match expected shape.");
  }

  return parsed;
}
