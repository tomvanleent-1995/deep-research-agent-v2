// src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { runResearchPipeline } from "@/lib/research/pipeline";
import { tavilySearch } from "@/config/tavily";
import { openai } from "@/config/openai";

export const runtime = "nodejs";

type OutputLanguage = "nl" | "en";

function pickLang(body: any): OutputLanguage {
  return body.outputLanguage === "en" ? "en" : "nl";
}

function looksDutch(text: string): boolean {
  const t = (text || "").toLowerCase();
  const hits = [
    " het ",
    " de ",
    " een ",
    " en ",
    " voor ",
    " met ",
    " omdat ",
    " zodat ",
    " ik ",
    " mijn ",
    " jullie ",
    " onderzoek",
    " beslissing",
    " strategie",
    " zichtbaarheid",
  ].filter((w) => t.includes(w)).length;

  return hits >= 3;
}

async function translateNlToEnIfNeeded(text: string): Promise<{ textEn: string; translated: boolean }> {
  const t = String(text ?? "").trim();
  if (!t) return { textEn: "", translated: false };
  if (!looksDutch(t)) return { textEn: t, translated: false };

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `Translate the following Dutch text to English. Output ONLY the English translation.\n\nDutch:\n${t}\n\nEnglish:`,
  });

  const out = resp.output_text?.trim() ?? "";
  if (!out) return { textEn: t, translated: false };
  return { textEn: out, translated: true };
}

function countWords(s: string): number {
  return (s || "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
}

function extractJson(text: string): unknown {
  const t = (text ?? "").trim();
  if (!t) throw new Error("LLM returned empty output");

  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(t.slice(start, end + 1));
    }
    throw new Error("LLM returned non-JSON output");
  }
}

/**
 * Report contract (hard) conform jouw specs:
 * - summaryBullets: 5–10 bullets
 * - summaryText: max 250 woorden (we checken dit extra)
 * - recommendation.uncertainties: altijd tonen; als geen onzekerheden dan expliciete zin
 * - research secties: intro + content (met [n]) + conclusion
 * - sources: alleen lijst met sourceNumber + title + url (+ optioneel meta)
 */
const ReportSchema = z.object({
  summaryBullets: z.array(z.string()).min(5).max(10),
  summaryText: z.string(),
  recommendation: z.object({
    choice: z.string().min(5),
    why: z.array(z.string()).min(1).max(12),
    conditions: z.array(z.string()).max(12),
    uncertainties: z.array(z.string()).min(1).max(12),
  }),
  research: z
    .array(
      z.object({
        title: z.string().min(3),
        intro: z.string().min(10),
        content: z.string().min(50),
        conclusion: z.string().min(10),
      })
    )
    .min(1),
  sources: z
    .array(
      z.object({
        sourceNumber: z.number().int().positive(),
        title: z.string().min(1),
        url: z.string().url(),
        publishedDate: z.string().optional(),
        provider: z.string().optional(),
        score: z.number().optional(),
      })
    )
    .min(1),
});

type Report = z.infer<typeof ReportSchema>;

function buildReportPrompt(args: {
  outputLang: OutputLanguage;
  decisionStatus: "EVIDENCE_SUFFICIENT" | "INSUFFICIENT_EVIDENCE";
  goalEn: string;
  decisionEn: string;
  sources: Array<{ sourceNumber: number; title: string; url: string; snippet: string }>;
}) {
  const { outputLang, decisionStatus, goalEn, decisionEn, sources } = args;

  const langLine = outputLang === "en" ? "Write in English." : "Schrijf in het Nederlands.";
  const evidenceLine =
    decisionStatus === "EVIDENCE_SUFFICIENT"
      ? outputLang === "en"
        ? "Evidence is sufficient. Make a clear recommendation."
        : "Er is voldoende bewijs. Maak een heldere aanbeveling."
      : outputLang === "en"
        ? "Evidence is insufficient. Recommendation must reflect this (delay/collect more evidence)."
        : "Er is onvoldoende bewijs. Aanbeveling moet dit weerspiegelen (uitstellen/meer bewijs).";

  const sourcesBlock = sources
    .slice(0, 30)
    .map(
      (s) =>
        `${s.sourceNumber}. ${s.title}\n   ${s.url}\n   Snippet: ${s.snippet}`
    )
    .join("\n\n");

  const uncertaintiesNoSig =
    outputLang === "en"
      ? "No significant uncertainties identified."
      : "Geen significante onzekerheden geïdentificeerd.";

  // Strict JSON schema description (no markdown)
  const schema = `{
  "summaryBullets": string[] (5-10 items),
  "summaryText": string (max 250 words),
  "recommendation": {
    "choice": string,
    "why": string[] (bullets; may include [n] citations),
    "conditions": string[] (bullets),
    "uncertainties": string[] (ALWAYS present; if none, include exactly: "${uncertaintiesNoSig}")
  },
  "research": [
    {
      "title": string,
      "intro": string (2-3 sentences),
      "content": string (full content; include citations like [1], [2] throughout),
      "conclusion": string (2-5 sentences; answer the research question for this section)
    }
  ],
  "sources": [
    { "sourceNumber": number, "title": string, "url": string, "publishedDate"?: string, "provider"?: string, "score"?: number }
  ]
}`;

  return `You are a senior research analyst.
You must produce a single JSON object that matches the exact schema below.
${langLine}
Research language context is English; output language must be the selected language.

Context:
- Goal (EN): ${goalEn}
- Decision (EN): ${decisionEn}
- DecisionStatus: ${decisionStatus}
- Citation style: use [n] where n matches sources.sourceNumber.

Hard requirements:
- Output MUST be valid JSON and match schema exactly.
- summaryBullets: 5-10 short bullets.
- summaryText: MAX 250 words (hard).
- recommendation.uncertainties: ALWAYS present; if no uncertainties, include exactly: "${uncertaintiesNoSig}"
- research: include multiple sections when helpful; each section must have intro, full content with [n] citations, and a conclusion.
- sources: only the list; no additional text after it.
- Do not invent sources. Only cite and use the provided sources.

Guidance:
${evidenceLine}

Provided sources (use these as evidence; cite with [n]):
${sourcesBlock}

Return ONLY JSON matching this schema:
${schema}`;
}

async function generateReport(params: {
  outputLang: OutputLanguage;
  decisionStatus: "EVIDENCE_SUFFICIENT" | "INSUFFICIENT_EVIDENCE";
  goalEn: string;
  decisionEn: string;
  sources: Array<{ sourceNumber: number; title: string; url: string; snippet: string; publishedDate?: string; provider?: string; score?: number }>;
}): Promise<Report> {
  const prompt = buildReportPrompt({
    outputLang: params.outputLang,
    decisionStatus: params.decisionStatus,
    goalEn: params.goalEn,
    decisionEn: params.decisionEn,
    sources: params.sources.map((s) => ({
      sourceNumber: s.sourceNumber,
      title: s.title,
      url: s.url,
      snippet: s.snippet,
    })),
  });

  const resp = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  const rawText = resp.output_text?.trim() ?? "";
  const json = extractJson(rawText);

  // Inject sources list from pipeline (authoritative), so the model can't drift.
  // We still let the model structure & write, but we control the sources payload.
  const parsed = ReportSchema.parse(json);

  // Hard enforce summaryText word limit.
  if (countWords(parsed.summaryText) > 250) {
    throw new Error("Report validation failed: summaryText exceeds 250 words");
  }

  // Overwrite sources with canonical numbered list from pipeline
  // (ensures numbering and URLs are exactly what we found).
  const canonicalSources = params.sources.map((s) => ({
    sourceNumber: s.sourceNumber,
    title: s.title,
    url: s.url,
    publishedDate: s.publishedDate,
    provider: s.provider,
    score: s.score,
  }));

  return {
    ...parsed,
    sources: canonicalSources,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const outputLanguage = pickLang(body);

    const goalRaw = String(body.goal ?? "");
    const decisionRaw = String(body.decision ?? "");

    if (!goalRaw.trim() || !decisionRaw.trim()) {
      return NextResponse.json({ error: "Missing required fields: goal, decision" }, { status: 400 });
    }

    // 1) Translate to English if needed (research language)
    const [goalT, decisionT] = await Promise.all([
      translateNlToEnIfNeeded(goalRaw),
      translateNlToEnIfNeeded(decisionRaw),
    ]);

    const goalEn = goalT.textEn;
    const decisionEn = decisionT.textEn;

    // 2) Run research pipeline in English ALWAYS
    const research = await runResearchPipeline(
      {
        goal: goalEn,
        decision: decisionEn,
        outputFormat: String(body.outputFormat ?? "structured"),
        outputLanguage, // keep user's preference for output language in any pipeline text
        constraints: body.constraints ? String(body.constraints) : undefined,
      },
      {
        searcher: tavilySearch,
        includeDebug: Boolean(body.debug ?? false),
      }
    );

    // 3) Build canonical numbered sources (1..N)
    const numberedSources = research.sources.map((s, i) => ({
      sourceNumber: i + 1,
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      publishedDate: s.publishedDate,
      provider: s.provider,
      score: s.score,
    }));

    // 4) Generate Report (always). It will reflect decisionStatus.
    const report = await generateReport({
      outputLang: outputLanguage,
      decisionStatus: research.decisionStatus,
      goalEn,
      decisionEn,
      sources: numberedSources,
    });

    // 5) Return response: report first-class, plus existing research meta
    return NextResponse.json(
      {
        decisionStatus: research.decisionStatus,
        confidenceOverview: research.confidenceOverview,
        report,
        // keep the rest for debugging/traceability and current UI compatibility
        sources: research.sources,
        debug: research.debug,
        meta: {
          researchLanguage: "en",
          translated: {
            goal: goalT.translated,
            decision: decisionT.translated,
          },
          goalEn,
          decisionEn,
          outputLanguage,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
