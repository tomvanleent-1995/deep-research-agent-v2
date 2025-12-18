// src/lib/research/pipeline.test.ts
import { describe, it, expect } from "vitest";
import type { Source } from "@/types/research";
import { runResearchPipeline, type TavilySearcher } from "@/lib/research/pipeline";

function src(url: string, title: string, provider: "tavily" | "unknown" = "tavily"): Source {
  return {
    url,
    title,
    snippet: "snippet",
    content: "content",
    provider,
  };
}

function makeDeterministicSearcher(): TavilySearcher {
  return async (q: string) => {
    const isAuthority = q.includes("authoritative sources") || q.includes("site:");
    const isExpand = q.includes("comparative analysis") || q.includes("latest evidence") || q.includes("failure modes");

    if (isAuthority) {
      return [
        src("https://example.org/auth/1", "Authority 1"),
        src("https://example.org/auth/2", "Authority 2"),
        src("https://example.org/shared", "Shared URL"),
      ];
    }

    if (isExpand) {
      return [
        src("https://example.com/exp/1", "Expand 1"),
        src("https://example.com/exp/2", "Expand 2"),
        src("https://example.org/shared", "Shared URL"),
      ];
    }

    return [
      src("https://seed.com/1", "Seed 1"),
      src("https://seed.com/2", "Seed 2"),
      src("https://example.org/shared", "Shared URL"),
    ];
  };
}

describe("runResearchPipeline (deterministic)", () => {
  it("produces 3 passes in order and dedupes sources", async () => {
    const searcher = makeDeterministicSearcher();

    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: true }
    );

    expect(out.debug?.passes.map((p) => p.pass)).toEqual(["seed", "expand", "authority"]);

    const urls = out.sources.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.filter((u) => u === "https://example.org/shared").length).toBe(1);
  });

  it("truncates Tavily queries to <= 400 chars deterministically", async () => {
    const searcher: TavilySearcher = async () => [src("https://seed.com/1", "Seed 1")];

    const longGoal = "X".repeat(1200);
    const out = await runResearchPipeline(
      { goal: longGoal, decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: true }
    );

    const seedPass = out.debug?.passes.find((p) => p.pass === "seed");
    expect(seedPass).toBeTruthy();

    const q0 = seedPass!.queries[0];
    expect(q0.usedLength).toBeLessThanOrEqual(400);
    expect(typeof q0.truncated).toBe("boolean");
  });

  it("returns INSUFFICIENT_EVIDENCE when not enough breadth", async () => {
    const searcher: TavilySearcher = async () => [src("https://one-domain.com/1", "Only 1")];

    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: false }
    );

    expect(out.decisionStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(out.confidenceOverview.overall).toBeLessThan(0.5);
  });

  it("returns EVIDENCE_SUFFICIENT when enough breadth", async () => {
    const searcher: TavilySearcher = async (q) => {
      const idx = q.length % 5;
      return [
        src(`https://a.com/${idx}`, "A"),
        src(`https://b.com/${idx}`, "B"),
        src(`https://c.com/${idx}`, "C"),
        src(`https://d.com/${idx}`, "D"),
      ];
    };

    const out = await runResearchPipeline(
      { goal: "Test", decision: "Pick option A vs B", outputFormat: "structured" },
      { searcher, includeDebug: false }
    );

    expect(out.decisionStatus).toBe("EVIDENCE_SUFFICIENT");
    expect(out.confidenceOverview.overall).toBeGreaterThanOrEqual(0.7);
  });
});
