// src/lib/research/pipeline.ts
import type { Source } from "@/types/research";

type DecisionStatus = "EVIDENCE_SUFFICIENT" | "INSUFFICIENT_EVIDENCE";

export type PipelineInput = {
  goal: string;
  decision: string;
  outputFormat: string;
  outputLanguage?: "nl" | "en";
  constraints?: string;
};

export type DebugPass = {
  pass: "seed" | "expand" | "authority";
  queries: Array<{
    q: string;
    truncated: boolean;
    originalLength: number;
    usedLength: number;
    hash: string;
  }>;
  sources: number;
  uniqueDomains: number;
};

export type PipelineOutput = {
  decisionStatus: DecisionStatus;
  recommendationOrSafeDefault: string;
  confidenceOverview: {
    overall: number; // 0..1
    rationale: string;
  };
  sources: Source[];
  debug?: { passes: DebugPass[] };
};

export type TavilySearcher = (query: string) => Promise<Source[]>;

const TAVILY_QUERY_MAX = 400;

const AUTHORITY_DOMAINS = [
  "wikipedia.org",
  "gov",
  "europa.eu",
  "who.int",
  "oecd.org",
  "imf.org",
  "worldbank.org",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "jamanetwork.com",
  "nejm.org",
  "harvard.edu",
  "mit.edu",
];

export async function runResearchPipeline(
  input: PipelineInput,
  deps: {
    searcher: TavilySearcher;
    includeDebug?: boolean;
  }
): Promise<PipelineOutput> {
  const debugPasses: DebugPass[] = [];

  const seedQueries = buildSeedQueries(input);
  const seed = await runTavilyPass("seed", seedQueries, deps.searcher);
  debugPasses.push(seed.debug);

  const expandQueries = buildExpandQueries(input, seed.sources);
  const expand = await runTavilyPass("expand", expandQueries, deps.searcher);
  debugPasses.push(expand.debug);

  const authorityQueries = buildAuthorityQueries(input, [...seed.sources, ...expand.sources]);
  const authority = await runTavilyPass("authority", authorityQueries, deps.searcher);
  debugPasses.push(authority.debug);

  const mergedSources = dedupeSourcesByUrl([...seed.sources, ...expand.sources, ...authority.sources]);

  const { decisionStatus, confidence, confidenceRationale } = simpleGate(mergedSources, input.outputLanguage);

  const recommendationOrSafeDefault =
    decisionStatus === "EVIDENCE_SUFFICIENT"
      ? buildRecommendationFromEvidence(input, mergedSources)
      : buildSafeDefault(input);

  return {
    decisionStatus,
    recommendationOrSafeDefault,
    confidenceOverview: {
      overall: confidence,
      rationale: confidenceRationale,
    },
    sources: mergedSources,
    ...(deps.includeDebug ? { debug: { passes: debugPasses } } : {}),
  };
}

// ============================
// Pass builders
// ============================
function buildSeedQueries(input: PipelineInput): string[] {
  const q1 = `${input.goal}. Context: ${input.decision}.`;
  const q2 = `${input.decision} evidence benchmarks and decision criteria`;
  const q3 = `${input.decision} risks edge cases trade-offs`;
  return [q1, q2, q3].map(normalizeQuery).filter(Boolean);
}

function buildExpandQueries(input: PipelineInput, seedSources: Source[]): string[] {
  const top = seedSources
    .slice(0, 6)
    .map((s) => `${s.title ?? ""} ${s.snippet ?? ""}`.trim())
    .filter(Boolean);

  const keywords = extractKeywordsDeterministic(top.join(" "), 10);

  const base = `${input.decision}`;
  const qs = [
    `${base} ${keywords.slice(0, 3).join(" ")} comparative analysis`,
    `${base} ${keywords.slice(3, 6).join(" ")} latest evidence`,
    `${base} ${keywords.slice(6, 10).join(" ")} failure modes`,
  ];

  return qs.map(normalizeQuery).filter(Boolean);
}

function buildAuthorityQueries(input: PipelineInput, sourcesSoFar: Source[]): string[] {
  const domains = Array.from(new Set(sourcesSoFar.map((s) => safeDomain(s.url)).filter(Boolean))).slice(0, 8);
  const domainHints = domains.length ? ` Already-seen domains: ${domains.join(", ")}.` : "";

  const base = normalizeQuery(`${input.decision} authoritative sources guidelines consensus${domainHints}`);

  const authoritySites = pickAuthorityDomains(3);
  const siteQ = authoritySites.map((d) => normalizeQuery(`${input.decision} site:${d} evidence`));

  return [base, ...siteQ].map(normalizeQuery).filter(Boolean);
}

// ============================
// Tavily pass runner
// ============================
async function runTavilyPass(
  pass: "seed" | "expand" | "authority",
  queries: string[],
  searcher: TavilySearcher
): Promise<{ sources: Source[]; debug: DebugPass }> {
  const qDebug: DebugPass["queries"] = [];
  const allSources: Source[] = [];

  for (const raw of queries) {
    const { q, truncated, originalLength, usedLength, hash } = truncateTavilyQuery(raw, TAVILY_QUERY_MAX);
    qDebug.push({ q, truncated, originalLength, usedLength, hash });

    logEvent("tavily.query", {
      pass,
      truncated,
      originalLength,
      usedLength,
      hash,
      qPreview: q.slice(0, 120),
    });

    const results = await searcher(q);
    allSources.push(...results);
  }

  const deduped = dedupeSourcesByUrl(allSources);
  const uniqueDomains = new Set(deduped.map((s) => safeDomain(s.url)).filter(Boolean)).size;

  logEvent("tavily.pass.complete", {
    pass,
    queries: queries.length,
    sources: deduped.length,
    uniqueDomains,
  });

  return {
    sources: deduped,
    debug: {
      pass,
      queries: qDebug,
      sources: deduped.length,
      uniqueDomains,
    },
  };
}

// ============================
// Gating (fallback)
// ============================
function simpleGate(
  sources: Source[],
  lang: "nl" | "en" | undefined
): {
  decisionStatus: DecisionStatus;
  confidence: number;
  confidenceRationale: string;
} {
  const uniqueDomains = new Set(sources.map((s) => safeDomain(s.url)).filter(Boolean)).size;
  const enough = sources.length >= 6 && uniqueDomains >= 4;

  if (enough) {
    return {
      decisionStatus: "EVIDENCE_SUFFICIENT",
      confidence: 0.78,
      confidenceRationale:
        lang === "en"
          ? `Sufficient breadth: ${sources.length} sources across ${uniqueDomains} domains.`
          : `Voldoende breedte: ${sources.length} bronnen over ${uniqueDomains} domeinen.`,
    };
  }

  return {
    decisionStatus: "INSUFFICIENT_EVIDENCE",
    confidence: 0.32,
    confidenceRationale:
      lang === "en"
        ? `Insufficient breadth: ${sources.length} sources across ${uniqueDomains} domains.`
        : `Onvoldoende breedte: ${sources.length} bronnen over ${uniqueDomains} domeinen.`,
  };
}

// ============================
// Output builders (LANG-AWARE)
// ============================
function buildRecommendationFromEvidence(input: PipelineInput, sources: Source[]): string {
  const lang = input.outputLanguage ?? "nl";
  const top = sources.slice(0, 5).map((s) => `- ${s.title || s.url}`).join("\n");

  if (lang === "en") {
    return `Recommendation (based on collected evidence):\n\nGoal: ${input.goal}\nDecision: ${input.decision}\n\nTop sources:\n${top}`;
  }

  return `Aanbeveling (op basis van gevonden evidence):\n\nDoel: ${input.goal}\nBeslissing: ${input.decision}\n\nTop bronnen:\n${top}`;
}

function buildSafeDefault(input: PipelineInput): string {
  const lang = input.outputLanguage ?? "nl";

  if (lang === "en") {
    return `Insufficient evidence to make a robust recommendation.\n\nSafe default:\n- Define explicit decision criteria (must-haves / nice-to-haves).\n- Collect 3–5 additional primary/authoritative sources.\n- Re-run the research with a tighter scope.\n\nContext:\nGoal: ${input.goal}\nDecision: ${input.decision}`;
  }

  return `Onvoldoende bewijs om een robuuste aanbeveling te doen.\n\nSafe default:\n- Formuleer expliciete besliscriteria (must-haves / nice-to-haves).\n- Verzamel 3–5 extra primaire/autoritatieve bronnen.\n- Herhaal het onderzoek met aangescherpte scope.\n\nContext:\nDoel: ${input.goal}\nBeslissing: ${input.decision}`;
}

// ============================
// Truncation + hashing
// ============================
function truncateTavilyQuery(query: string, maxLen: number): {
  q: string;
  truncated: boolean;
  originalLength: number;
  usedLength: number;
  hash: string;
} {
  const q0 = normalizeQuery(query);
  const originalLength = q0.length;

  if (originalLength <= maxLen) {
    return { q: q0, truncated: false, originalLength, usedLength: originalLength, hash: fnv1a(q0) };
  }

  const marker = " … ";
  const keep = maxLen - marker.length;
  const headLen = Math.floor(keep * 0.72);
  const tailLen = keep - headLen;

  const head = q0.slice(0, headLen).trimEnd();
  const tail = q0.slice(q0.length - tailLen).trimStart();

  const q = (head + marker + tail).slice(0, maxLen);

  return {
    q,
    truncated: true,
    originalLength,
    usedLength: q.length,
    hash: fnv1a(q0),
  };
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `fnv1a32:${h.toString(16).padStart(8, "0")}`;
}

// ============================
// Utilities
// ============================
function dedupeSourcesByUrl(sources: Source[]): Source[] {
  const map = new Map<string, Source>();
  for (const s of sources) {
    if (!s?.url) continue;
    if (!map.has(s.url)) map.set(s.url, s);
  }
  return Array.from(map.values());
}

function normalizeQuery(q: string): string {
  return (q || "").replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

function safeDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pickAuthorityDomains(n: number): string[] {
  return AUTHORITY_DOMAINS.slice(0, n);
}

function extractKeywordsDeterministic(text: string, max: number): string[] {
  const cleaned = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const stop = new Set([
    "the","and","for","with","from","that","this","are","was","were","you","your","their",
    "about","into","over","under","more","less","than","then","also","how","what","why",
    "when","where","which","who","whom","can","could","should","would","may","might",
    "evidence","analysis","research","study","studies","report","reports"
  ]);

  const freq = new Map<string, number>();
  for (const token of cleaned.split(" ")) {
    if (token.length < 4) continue;
    if (stop.has(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

function logEvent(event: string, payload: Record<string, unknown>) {
  const isTest = typeof process !== "undefined" && !!process.env.VITEST;
  const logsEnabled = process.env.RESEARCH_LOGS !== "0";
  if (isTest || !logsEnabled) return;
  console.log(JSON.stringify({ event, ...payload }));
}
