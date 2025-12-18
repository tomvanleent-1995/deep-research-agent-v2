// src/types/research.ts

export type { ResearchInput, RiskTolerance, TimeHorizon } from "@/lib/research/schema";

/**
 * Buckets die je research agent gebruikt om subvragen te groeperen.
 * Moet matchen met de buckets die je in subquestions/scoring/pipeline hanteert.
 */
export type ResearchBucket =
  | "DecisionCriteria"
  | "OptionsLandscape"
  | "EvidenceBenchmarks"
  | "RisksEdgeCases";

export type Source = {
  url: string;
  title: string;
  snippet: string;
  content: string;
  rawContent?: string;
  publishedDate?: string;
  provider: "tavily" | "unknown";

  score?: number;
  scoreBreakdown?: Record<string, number>;
};

export type GateMetrics = {
  sources: number;
  uniqueDomains: number;
  avgScore: number;

  // Gate v1 additions (optie A)
  topSourceScore: number;
  top3AvgScore: number;
  lowInfoRatio: number;
};

export type ResearchResult = {
  decisionStatus: "INSUFFICIENT_EVIDENCE" | "EVIDENCE_SUFFICIENT";
  recommendationOrSafeDefault: string;
  confidenceOverview: GateMetrics;
  sources: Source[];
};
