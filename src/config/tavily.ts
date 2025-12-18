// src/config/tavily.ts
import type { Source } from "@/types/research";

type TavilySearchResponse = {
  results?: Array<{
    url?: string;
    title?: string;
    content?: string;
    snippet?: string;
    published_date?: string;
  }>;
};

export async function tavilySearch(query: string): Promise<Source[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TAVILY_API_KEY env var");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
      max_results: 8,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily error: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as TavilySearchResponse;
  const results = data.results ?? [];

  return results
    .filter((r) => !!r.url)
    .map((r) => ({
      url: r.url as string,
      title: r.title ?? "",
      snippet: r.snippet ?? "",
      content: r.content ?? "",
      rawContent: undefined,
      publishedDate: r.published_date,
      provider: "tavily",
    }));
}
