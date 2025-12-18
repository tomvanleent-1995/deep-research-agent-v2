import { z } from "zod";

export const SummaryBulletsSchema = z
  .array(z.string().max(120))
  .min(5)
  .max(10);

export const SummaryTextSchema = z
  .string()
  .max(250 * 6); // ~250 woorden, defensief via chars

export const RecommendationSchema = z.object({
  choice: z.string().min(5),
  why: z.array(z.string()).min(3).max(6),
  conditions: z.array(z.string()).max(6),
  uncertainties: z.array(z.string()).min(1), // altijd tonen
});

export const ResearchSectionSchema = z.object({
  title: z.string(),
  intro: z.string().min(20),
  content: z.string().min(200), // volledige inhoud
  conclusion: z.string().min(40),
});

export const SourceSchema = z.object({
  sourceNumber: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  publishedDate: z.string().optional(),
  provider: z.string().optional(),
  score: z.number().optional(),
});

export const ReportSchema = z.object({
  summaryBullets: SummaryBulletsSchema,
  summaryText: SummaryTextSchema,
  recommendation: RecommendationSchema,
  research: z.array(ResearchSectionSchema).min(1),
  sources: z.array(SourceSchema).min(1),
});

export type Report = z.infer<typeof ReportSchema>;
