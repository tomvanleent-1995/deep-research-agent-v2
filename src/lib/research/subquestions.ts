import type { ResearchBucket, ResearchInput } from "@/types/research";

export type SubQuestion = {
  bucket: ResearchBucket;
  subquestion: string;
  researchObjective: string;
  allowedOutcomes: Array<"positive" | "negative" | "inconclusive">;
  disconfirmationRule: string;
};

export function generateSubQuestions(_input: ResearchInput): SubQuestion[] {
  const out: SubQuestion[] = [
    // DecisionCriteria (2)
    {
      bucket: "DecisionCriteria",
      subquestion: "Welke criteria zijn aantoonbaar relevant voor deze beslissing?",
      researchObjective:
        "Objectief vaststellen welke evaluatiecriteria expliciet terugkomen in betrouwbare bronnen en in vergelijkbare beslissingen.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Markeer als inconclusive als criteria alleen subjectief of zonder herleidbare bron worden genoemd.",
    },
    {
      bucket: "DecisionCriteria",
      subquestion:
        "Welke trade-offs worden expliciet genoemd tussen de belangrijkste criteria?",
      researchObjective:
        "Vaststellen welke afruilen (bijv. kosten vs kwaliteit, snelheid vs betrouwbaarheid) feitelijk benoemd worden, zonder voorkeur.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Neem geen trade-offs op zonder primaire bron of onafhankelijke bevestiging.",
    },

    // OptionsLandscape (2)
    {
      bucket: "OptionsLandscape",
      subquestion:
        "Welke oplossingsrichtingen/categorieën bestaan er aantoonbaar voor deze beslissing?",
      researchObjective:
        "In kaart brengen van gangbare categorieën en alternatieven op basis van documentatie en onafhankelijke overzichten, zonder ranking.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Sluit opties uit die alleen op marketingclaims berusten zonder onafhankelijke bron.",
    },
    {
      bucket: "OptionsLandscape",
      subquestion:
        "Welke opties blijken aantoonbaar ongeschikt voor bepaalde contexten of constraints?",
      researchObjective:
        "Identificeren van contexten waarin bepaalde opties niet passen (bijv. budget, compliance, schaal), op basis van expliciete beperkingen/cases.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Als 'ongeschikt' niet wordt onderbouwd met concrete beperking/case: markeer als inconclusive.",
    },

    // EvidenceBenchmarks (2)
    {
      bucket: "EvidenceBenchmarks",
      subquestion:
        "Welke verifieerbare benchmarks, prijzen, limieten of prestaties zijn beschikbaar?",
      researchObjective:
        "Verzamelen van meetbare feiten (prijzen, quotas, latency, features, SLA’s), herleidbaar naar primaire bronnen.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Cijfers zonder herleidbare bron niet gebruiken; bij twijfel labelen als inconclusive en niet in conclusies opnemen.",
    },
    {
      bucket: "EvidenceBenchmarks",
      subquestion:
        "Welke kernclaims worden door meerdere onafhankelijke bronnen bevestigd?",
      researchObjective:
        "Bepalen welke uitspraken corroboratie hebben en welke niet; conflicten expliciet maken.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Minder dan 2 onafhankelijke bronnen = claim niet als bevestigd opnemen (hoogstens 'unverified').",
    },

    // RisksEdgeCases (min 1)
    {
      bucket: "RisksEdgeCases",
      subquestion:
        "Welke risico’s, failure modes en lock-in aspecten worden expliciet genoemd?",
      researchObjective:
        "Objectief inventariseren van risico’s en beperkingen (compliance, data, vendor lock-in, operationeel), alleen op basis van bronnen.",
      allowedOutcomes: ["positive", "negative", "inconclusive"],
      disconfirmationRule:
        "Risico’s zonder bron of alleen hypothetisch niet opnemen; markeer als inconclusive.",
    },
  ];

  // Coverage rules (defensive)
  const counts: Record<ResearchBucket, number> = {
    DecisionCriteria: 0,
    OptionsLandscape: 0,
    EvidenceBenchmarks: 0,
    RisksEdgeCases: 0,
  };

  for (const q of out) counts[q.bucket]++;

  const ok =
    counts.DecisionCriteria >= 2 &&
    counts.OptionsLandscape >= 2 &&
    counts.EvidenceBenchmarks >= 2 &&
    counts.RisksEdgeCases >= 1;

  if (!ok) throw new Error("SubQuestion coverage rules not satisfied.");

  return out;
}
