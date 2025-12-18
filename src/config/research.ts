// src/config/research.ts
export const RESEARCH_CONFIG = {
  tavily: {
    maxResults: 10,
    searchDepth: "advanced" as const,
    includeAnswer: false,
    // SDK verwacht: false | "text" | "markdown" | undefined
    includeRawContent: "text" as const,
  },

  gates: {
    minSources: 4,
    minUniqueDomains: 3,
    minAvgSourceScore: 60,
    minTopSourceScore: 70,
  },

  quality: {
    highTrustDomains: [
      "docs.tavily.com",
      "openai.com",
      "developer.mozilla.org",
      "nextjs.org",
      "vercel.com",
      "github.com",
      "npmjs.com",
    ],
    lowTrustContains: ["medium.com", "substack.com", "blogspot.", "wordpress.", "wixsite."],
  },
};
