import type { Source, GateMetrics } from "@/types/research";

type GateResult = {
  passed: boolean;
  metrics: GateMetrics;
  scored: Source[];
};

function clamp(n: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function uniqueDomains(urls: string[]) {
  const domains = new Set<string>();
  for (const u of urls) {
    try {
      const d = new URL(u).hostname.replace(/^www\./, "");
      domains.add(d);
    } catch {
      // ignore invalid URLs
    }
  }
  return domains.size;
}

/**
 * Very simple scoring heuristic:
 * - snippet presence matters (quick relevance signal)
 * - content length matters (but can be noisy → capped)
 */
function scoreOne(source: Source): { score: number; breakdown: Record<string, number> } {
  const snippetLen = (source.snippet ?? "").trim().length;
  const contentLen = (source.content ?? "").trim().length;

  // snippet quality: 0..1 (cap at 300 chars)
  const snippetScore = clamp(snippetLen / 300);

  // content quality: 0..1 (cap at 2500 chars; avoid “infinite long” bias)
  const contentScore = clamp(contentLen / 2500);

  // weighted score
  const score = 0.45 * snippetScore + 0.55 * contentScore;

  return {
    score,
    breakdown: {
      snippet: snippetScore,
      content: contentScore,
    },
  };
}

export function scoreSourcesAndGate(sources: Source[]): GateResult {
  const scored: Source[] = sources.map((s) => {
    const { score, breakdown } = scoreOne(s);
    return {
      ...s,
      score,
      scoreBreakdown: breakdown,
    };
  });

  // sort desc by score
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const sourceCount = scored.length;
  const domainCount = uniqueDomains(scored.map((s) => s.url));

  const avgScore =
    sourceCount === 0
      ? 0
      : scored.reduce((sum, s) => sum + (typeof s.score === "number" ? s.score : 0), 0) / sourceCount;

  const topSourceScore = sourceCount > 0 && typeof scored[0].score === "number" ? scored[0].score : 0;

  const top3 = scored.slice(0, 3);
  const top3AvgScore =
    top3.length === 0
      ? 0
      : top3.reduce((sum, s) => sum + (typeof s.score === "number" ? s.score : 0), 0) / top3.length;

  // “low info” heuristic: too-short content or snippet
  const lowInfoCount = scored.filter((s) => {
    const contentLen = (s.content ?? "").trim().length;
    const snippetLen = (s.snippet ?? "").trim().length;
    return contentLen < 400 || snippetLen < 80;
  }).length;

  const lowInfoRatio = sourceCount === 0 ? 1 : lowInfoCount / sourceCount;

  const metrics: GateMetrics = {
    sources: sourceCount,
    uniqueDomains: domainCount,
    avgScore,
    topSourceScore,
    top3AvgScore,
    lowInfoRatio,
  };

  // Gate rules (v1)
  const passed =
    metrics.sources >= 12 &&
    metrics.uniqueDomains >= 6 &&
    metrics.avgScore >= 0.45 &&
    metrics.topSourceScore >= 0.65 &&
    metrics.top3AvgScore >= 0.55 &&
    metrics.lowInfoRatio <= 0.5;

  return { passed, metrics, scored };
}
