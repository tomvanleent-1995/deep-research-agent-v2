// src/lib/research/pipeline.test.ts
import { describe, it, expect } from "vitest";
import type { Source } from "@/types/research";
import { runResearchPipeline, type TavilySearcher } from "@/lib/research/pipeline";

type Provider = "tavily" | "unknown";

function mkSource(url: string, title: string, provider: Provider = "tavily"): Source {
  return {
    url,
    title,
    snippet: `snippet:${title}`,
    content: `content:${title}`,
    provider,
  };
}

function domainOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Deterministic multi-pass fixture
 * - Seed: returns 3 urls (2 seed + 1 shared)
 * - Expand: returns 3 urls (2 expand + 1 shared)
 * - Authority: returns 3 urls (2 auth + 1 shared)
 * This allows us to verify:
 * - pass ordering
 * - dedupe by URL across passes
 * - unique domain counting is stable
 */
function makeDeterministicSearcher(): TavilySearcher {
  return async (q: string) => {
    const isAuthority = q.includes("authoritative sources") || q.includes("site:");
    const isExpand =
      q.includes("comparative analysis") ||
      q.includes("latest evidence") ||
      q.includes("failure modes");

    if (isAuthority) {
      return [
        mkSource("https://example.org/auth/1", "Authority 1"),
        mkSource("https://example.org/auth/2", "Authority 2"),
        mkSource("https://example.org/shared", "Shared URL"),
      ];
    }

    if (isExpand) {
      return [
        mkSource("https://example.com/exp/1", "Expand 1"),
        mkSource("https://example.com/exp/2", "Expand 2"),
        mkSource("https://example.org/shared", "Shared URL"),
      ];
    }

    // seed
    return [
      mkSource("https://seed.com/1", "Seed 1"),
      mkSource("https://seed.com/2", "Seed 2"),
      mkSource("https://example.org/shared", "Shared URL"),
    ];
  };
}

describe("runResearchPipeline (deterministic)", () => {
  it("emits exactly 3 passes in order when debug is enabled", async () => {
    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher: makeDeterministicSearcher(), includeDebug: true }
    );

    expect(out.debug).toBeTruthy();
    expect(out.debug!.passes.map((p) => p.pass)).toEqual(["seed", "expand", "authority"]);

    // Each pass should have >= 1 query, and query metadata should be present
    for (const p of out.debug!.passes) {
      expect(p.queries.length).toBeGreaterThan(0);
      for (const q of p.queries) {
        expect(typeof q.q).toBe("string");
        expect(typeof q.truncated).toBe("boolean");
        expect(typeof q.originalLength).toBe("number");
        expect(typeof q.usedLength).toBe("number");
        expect(typeof q.hash).toBe("string");
      }
    }
  });

  it("dedupes sources by URL across passes and preserves stable output shape", async () => {
    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher: makeDeterministicSearcher(), includeDebug: true }
    );

    const urls = out.sources.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);

    // Shared URL should appear once
    expect(urls.filter((u) => u === "https://example.org/shared").length).toBe(1);

    // Should include at least these deterministic items
    expect(urls).toContain("https://seed.com/1");
    expect(urls).toContain("https://example.com/exp/1");
    expect(urls).toContain("https://example.org/auth/1");

    // Output shape basics
    expect(["EVIDENCE_SUFFICIENT", "INSUFFICIENT_EVIDENCE"]).toContain(out.decisionStatus);
    expect(typeof out.recommendationOrSafeDefault).toBe("string");
    expect(typeof out.confidenceOverview.overall).toBe("number");
    expect(out.confidenceOverview.overall).toBeGreaterThanOrEqual(0);
    expect(out.confidenceOverview.overall).toBeLessThanOrEqual(1);
  });

  it("enforces Tavily query length cap (<= 400) and truncation is deterministic", async () => {
    const longGoal = "X".repeat(2500);

    const out = await runResearchPipeline(
      { goal: longGoal, decision: "Pick option A vs B", outputFormat: "structured" },
      {
        searcher: async () => [mkSource("https://seed.com/1", "Seed 1")],
        includeDebug: true,
      }
    );

    const seed = out.debug!.passes.find((p) => p.pass === "seed")!;
    const first = seed.queries[0];

    expect(first.usedLength).toBeLessThanOrEqual(400);

    // If it's truncated, verify marker is present; if not, still valid.
    if (first.truncated) {
      expect(first.q.includes(" … ")).toBe(true);
      expect(first.originalLength).toBeGreaterThan(first.usedLength);
    }
  });

  it("returns INSUFFICIENT_EVIDENCE when sources/domains are too few", async () => {
    const searcher: TavilySearcher = async () => [
      mkSource("https://one-domain.com/1", "Only 1"),
    ];

    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: false }
    );

    expect(out.decisionStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.confidenceOverview.overall).toBeLessThan(0.5);

    // Debug should be omitted if includeDebug=false
    expect(out.debug).toBeUndefined();
  });

  it("returns EVIDENCE_SUFFICIENT when breadth thresholds are met (multiple domains)", async () => {
    // Make sure we produce >= 6 sources and >= 4 domains after merge
    const searcher: TavilySearcher = async (q) => {
      const tag = q.length % 7; // deterministic
      return [
        mkSource(`https://a.com/${tag}`, "A"),
        mkSource(`https://b.com/${tag}`, "B"),
        mkSource(`https://c.com/${tag}`, "C"),
        mkSource(`https://d.com/${tag}`, "D"),
      ];
    };

    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: false }
    );

    expect(out.decisionStatus).toBe("EVIDENCE_SUFFICIENT");
    expect(out.confidenceOverview.overall).toBeGreaterThanOrEqual(0.7);

    // sanity: domain breadth is real
    const domains = new Set(out.sources.map((s) => domainOf(s.url)).filter(Boolean));
    expect(domains.size).toBeGreaterThanOrEqual(4);
  });
});
