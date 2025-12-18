import { z } from "zod";

export const RiskToleranceSchema = z.enum(["low", "medium", "high"]);
export const TimeHorizonSchema = z.enum(["now", "quarter", "year"]);

export const ResearchInputSchema = z.object({
  decision: z.string().min(10),
  context: z.string().min(10),
  outputPurpose: z.string().min(3),
  riskTolerance: RiskToleranceSchema,
  timeHorizon: TimeHorizonSchema,
});

export type ResearchInput = z.infer<typeof ResearchInputSchema>;
export type RiskTolerance = z.infer<typeof RiskToleranceSchema>;
export type TimeHorizon = z.infer<typeof TimeHorizonSchema>;
