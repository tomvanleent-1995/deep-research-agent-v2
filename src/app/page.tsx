"use client";

import { useMemo, useState } from "react";

type OutputLanguage = "nl" | "en";

type Report = {
  summaryBullets: string[];
  summaryText: string;
  recommendation: {
    choice: string;
    why: string[];
    conditions: string[];
    uncertainties: string[];
  };
  research: Array<{
    title: string;
    intro: string;
    content: string;
    conclusion: string;
  }>;
  sources: Array<{
    sourceNumber: number;
    title: string;
    url: string;
    publishedDate?: string;
    provider?: string;
    score?: number;
  }>;
};

type ApiResponse = {
  decisionStatus: "EVIDENCE_SUFFICIENT" | "INSUFFICIENT_EVIDENCE";
  confidenceOverview?: string;
  report: Report;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Turns plain text with [n] citations into safe HTML with links to #source-n anchors.
 * Preserves line breaks.
 */
function linkifyCitationsToHtml(text: string): string {
  const safe = escapeHtml(text || "");
  const withLinks = safe.replace(/\[(\d+)\]/g, (_m, n) => {
    const id = Number(n);
    if (!Number.isFinite(id) || id <= 0) return _m;
    return `<a href="#source-${id}" class="underline text-blue-700">[${id}]</a>`;
  });
  return withLinks.replace(/\n/g, "<br/>");
}

function toMarkdown(report: Report, decisionStatus: ApiResponse["decisionStatus"], confidenceOverview?: string) {
  const lines: string[] = [];

  lines.push(`# Deep Research Report`);
  lines.push("");
  lines.push(`**Decision status:** ${decisionStatus}`);
  if (confidenceOverview) {
    lines.push("");
    lines.push(`**Confidence overview:** ${confidenceOverview}`);
  }

  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  for (const b of report.summaryBullets) lines.push(`- ${b}`);

  lines.push("");
  lines.push(report.summaryText.trim());
  lines.push("");

  lines.push(`## Recommendation`);
  lines.push("");
  lines.push(`**Choice:** ${report.recommendation.choice}`);
  lines.push("");
  lines.push(`**Why:**`);
  for (const w of report.recommendation.why) lines.push(`- ${w}`);
  lines.push("");
  lines.push(`**Conditions:**`);
  if (report.recommendation.conditions.length === 0) {
    lines.push(`- —`);
  } else {
    for (const c of report.recommendation.conditions) lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push(`**Uncertainties:**`);
  for (const u of report.recommendation.uncertainties) lines.push(`- ${u}`);

  lines.push("");
  lines.push(`## Research`);
  lines.push("");
  report.research.forEach((sec, idx) => {
    lines.push(`### ${idx + 1}. ${sec.title}`);
    lines.push("");
    lines.push(`_Intro:_ ${sec.intro.trim()}`);
    lines.push("");
    lines.push(sec.content.trim());
    lines.push("");
    lines.push(`**Conclusion:** ${sec.conclusion.trim()}`);
    lines.push("");
  });

  lines.push(`## Sources`);
  lines.push("");
  for (const s of report.sources) {
    lines.push(`${s.sourceNumber}. ${s.title}`);
    lines.push(`   ${s.url}`);
  }

  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [goal, setGoal] = useState("");
  const [decision, setDecision] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("nl");
  const [debug, setDebug] = useState(false);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Collapsible research: track open indices
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});

  const md = useMemo(() => {
    if (!data) return "";
    return toMarkdown(data.report, data.decisionStatus, data.confidenceOverview);
  }, [data]);

  async function submit() {
    setLoading(true);
    setError(null);
    setData(null);
    setOpenSections({});

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          decision,
          outputLanguage,
          debug,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error ?? "Request failed");
      }

      const json = (await res.json()) as ApiResponse;

      // Default open: first 2 sections open
      const initialOpen: Record<number, boolean> = {};
      json.report.research.forEach((_s, i) => {
        initialOpen[i] = i < 2;
      });

      setData(json);
      setOpenSections(initialOpen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function toggleSection(idx: number) {
    setOpenSections((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  function openAll() {
    if (!data) return;
    const next: Record<number, boolean> = {};
    data.report.research.forEach((_s, i) => (next[i] = true));
    setOpenSections(next);
  }

  function closeAll() {
    if (!data) return;
    const next: Record<number, boolean> = {};
    data.report.research.forEach((_s, i) => (next[i] = false));
    setOpenSections(next);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-10">
      {/* INPUT */}
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Deep Research Agent</h1>

        <textarea
          className="w-full border rounded p-3"
          rows={3}
          placeholder="Goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <textarea
          className="w-full border rounded p-3"
          rows={3}
          placeholder="Decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-4">
          <select
            className="border rounded p-2"
            value={outputLanguage}
            onChange={(e) => setOutputLanguage(e.target.value as OutputLanguage)}
          >
            <option value="nl">Nederlands</option>
            <option value="en">English</option>
          </select>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            Debug
          </label>

          <button
            onClick={submit}
            disabled={loading}
            className="ml-auto rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Running…" : "Run research"}
          </button>
        </div>

        {error && <p className="text-red-600">{error}</p>}
      </section>

      {/* OUTPUT */}
      {data && (
        <section className="space-y-10">
          {/* HEADER / ACTIONS */}
          <section className="space-y-3 border rounded p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm text-gray-700">
                Decision status: <strong>{data.decisionStatus}</strong>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={copyMarkdown}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Copy report
                </button>
                <button
                  onClick={() => downloadTextFile("report.md", md)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Download .md
                </button>
              </div>
            </div>
            {data.confidenceOverview && (
              <p className="text-sm text-gray-600">{data.confidenceOverview}</p>
            )}
          </section>

          {/* 1. SUMMARY BULLETS */}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Summary</h2>
            <ul className="list-disc pl-5 space-y-1">
              {data.report.summaryBullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </section>

          {/* 2. SUMMARY TEXT */}
          <section className="space-y-3">
            <p className="whitespace-pre-line">{data.report.summaryText}</p>
          </section>

          {/* 3. RECOMMENDATION */}
          <section className="space-y-6">
            <h2 className="text-xl font-semibold">Recommendation</h2>

            <div>
              <h3 className="font-medium">Choice</h3>
              <p>{data.report.recommendation.choice}</p>
            </div>

            <div>
              <h3 className="font-medium">Why</h3>
              <ul className="list-disc pl-5 space-y-1">
                {data.report.recommendation.why.map((w, i) => (
                  <li
                    key={i}
                    dangerouslySetInnerHTML={{ __html: linkifyCitationsToHtml(w) }}
                  />
                ))}
              </ul>
            </div>

            <div>
              <h3 className="font-medium">Conditions</h3>
              {data.report.recommendation.conditions.length === 0 ? (
                <p className="text-sm text-gray-600">—</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {data.report.recommendation.conditions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="font-medium">Uncertainties</h3>
              <ul className="list-disc pl-5 space-y-1">
                {data.report.recommendation.uncertainties.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          </section>

          {/* 4. RESEARCH */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">Research</h2>
              <div className="ml-auto flex gap-2">
                <button onClick={openAll} className="rounded border px-3 py-1 text-sm">
                  Open all
                </button>
                <button onClick={closeAll} className="rounded border px-3 py-1 text-sm">
                  Close all
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {data.report.research.map((sec, i) => {
                const isOpen = Boolean(openSections[i]);
                return (
                  <article key={i} className="border rounded">
                    <button
                      onClick={() => toggleSection(i)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3"
                    >
                      <span className="text-sm text-gray-600">
                        {i + 1}
                      </span>
                      <span className="font-medium">{sec.title}</span>
                      <span className="ml-auto text-sm text-gray-600">
                        {isOpen ? "Hide" : "Show"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3">
                        <p className="italic text-gray-700">{sec.intro}</p>

                        <p
                          className="whitespace-pre-line"
                          dangerouslySetInnerHTML={{
                            __html: linkifyCitationsToHtml(sec.content),
                          }}
                        />

                        <p className="font-medium">{sec.conclusion}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {/* 5. SOURCES */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Sources</h2>
            <ol className="list-decimal pl-5 space-y-3">
              {data.report.sources.map((s) => (
                <li key={s.sourceNumber} id={`source-${s.sourceNumber}`}>
                  <div className="text-sm">
                    <strong>
                      [{s.sourceNumber}] {s.title}
                    </strong>
                  </div>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-600 underline"
                  >
                    {s.url}
                  </a>
                  {(s.publishedDate || s.provider || typeof s.score === "number") && (
                    <div className="text-xs text-gray-600 mt-1">
                      {s.publishedDate ? <span>{s.publishedDate}</span> : null}
                      {s.provider ? <span>{s.publishedDate ? " · " : ""}{s.provider}</span> : null}
                      {typeof s.score === "number" ? (
                        <span>{(s.publishedDate || s.provider) ? " · " : ""}score: {s.score}</span>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </section>
      )}
    </main>
  );
}
