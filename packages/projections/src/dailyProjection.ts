import { dailyProjectionSchema, isoDateSchema, type DailyProjection, type ProjectProjection } from "@flowcontext/domain";

export interface DailyProjectionInput {
  date: string;
  dailyLens?: string | null;
  projects: readonly ProjectProjection[];
  macReport?: string | null;
  windowsReport?: string | null;
}

export function buildDailyProjection(input: DailyProjectionInput): DailyProjection {
  isoDateSchema.parse(input.date);
  return dailyProjectionSchema.parse({
    date: input.date,
    dailyLens: input.dailyLens ?? "",
    projects: [...input.projects],
    macReport: input.macReport ?? null,
    windowsReport: input.windowsReport ?? null,
  });
}
