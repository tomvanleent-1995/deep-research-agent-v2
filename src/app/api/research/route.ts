// src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { runResearchPipeline } from "@/lib/research/pipeline";
import { tavilySearch } from "@/lib/research/tavily";

// Optioneel: force node runtime (Tavily fetch + env)
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Verwacht minimaal deze velden; match dit met jouw bestaande schema
    const input = {
      goal: String(body.goal ?? ""),
      decision: String(body.decision ?? ""),
      outputFormat: String(body.outputFormat ?? "structured"),
      constraints: body.constraints ? String(body.constraints) : undefined,
    };

    if (!input.goal || !input.decision) {
      return NextResponse.json(
        { error: "Missing required fields: goal, decision" },
        { status: 400 }
      );
    }

    const result = await runResearchPipeline(input, {
      searcher: tavilySearch,
      includeDebug: Boolean(body.debug ?? false),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
