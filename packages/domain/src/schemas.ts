import { z } from "zod";

const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = dateParts.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

/** Calendar-valid ISO date in the exact YYYY-MM-DD representation. */
export const isoDateSchema = z
  .string()
  .regex(dateParts, "date must use YYYY-MM-DD")
  .refine(isCalendarDate, "date must be a valid calendar date");

export const dateSchema = isoDateSchema;

const clockTimeValueSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "time must use HH:mm");

/** Optional planned time: a 24-hour HH:mm value or null/undefined. */
export const timeSchema = clockTimeValueSchema.nullable().optional();
export const optionalTimeSchema = timeSchema.default(null);

const idSchema = z.string().trim().min(1, "id is required");
const textSchema = z.string();
const nonEmptyTextSchema = z.string().trim().min(1);
const dateTimeSchema = z.string().datetime({ offset: true });

export const topicStateSchema = z.enum(["open", "done"]);
export const projectLifecycleStatusSchema = z.enum(["inbox", "active", "paused", "done", "archived"]);

export const projectProjectionSchema = z
  .object({
    id: idSchema.nullable().optional(),
    projectKey: nonEmptyTextSchema,
    title: nonEmptyTextSchema,
    lifecycleStatus: projectLifecycleStatusSchema,
    summary: textSchema,
    nextAction: textSchema,
    sourcePath: nonEmptyTextSchema.optional(),
    lastSyncedAt: dateTimeSchema.nullable().optional(),
  })
  .strict();

export const topicCardSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    title: nonEmptyTextSchema,
    state: topicStateSchema,
    currentState: textSchema.default(""),
    nextAction: textSchema.default(""),
    openQuestions: z.array(textSchema).default([]),
    latestHandoffId: idSchema.nullable().optional(),
    lastActiveAt: dateTimeSchema,
    focusRank: z.number().int().nullable().optional(),
    resurfaceAt: dateTimeSchema.nullable().optional(),
    resurfaceCondition: textSchema.nullable().optional(),
  })
  .strict();

export const sessionSchema = z
  .object({
    id: idSchema,
    topicCardId: idSchema,
    codexThreadId: idSchema,
    deviceId: idSchema,
    platform: z.enum(["macos", "windows"]).nullable().optional(),
    workspacePath: nonEmptyTextSchema,
    startedAt: dateTimeSchema,
    endedAt: dateTimeSchema.nullable().optional(),
  })
  .strict();

export const handoffSchema = z
  .object({
    id: idSchema,
    sessionId: idSchema,
    topicCardId: idSchema,
    content: textSchema,
    idempotencyKey: nonEmptyTextSchema,
    createdAt: dateTimeSchema.optional(),
    generatedAt: dateTimeSchema.optional(),
  })
  .strict();

export const handoffCreateSchema = z
  .object({
    sessionId: idSchema,
    topicCardId: idSchema,
    content: textSchema,
    idempotencyKey: nonEmptyTextSchema,
  })
  .strict();

export const todoSchema = z
  .object({
    id: idSchema,
    title: nonEmptyTextSchema,
    plannedDate: isoDateSchema,
    plannedTime: optionalTimeSchema,
    isCompleted: z.boolean().default(false),
    projectId: idSchema.nullable().optional(),
    topicCardId: idSchema.nullable().optional(),
  })
  .strict();

export const dailyProjectionSchema = z
  .object({
    date: isoDateSchema,
    dailyLens: textSchema,
    projects: z.array(projectProjectionSchema),
    macReport: textSchema.nullable().optional(),
    windowsReport: textSchema.nullable().optional(),
  })
  .strict();

export const deviceWorkspaceSchema = z
  .object({
    deviceId: idSchema,
    platform: z.enum(["macos", "windows"]),
    projectId: idSchema,
    workspacePath: nonEmptyTextSchema,
  })
  .strict();

/**
 * Safe fields that a confirmed Handoff may copy back onto its Topic Card.
 * Topic state and all Project lifecycle fields intentionally have no schema
 * member and are rejected as unknown keys.
 */
export const handoffUpdateSchema = z
  .object({
    currentState: textSchema.optional(),
    nextAction: textSchema.optional(),
    openQuestions: z.array(textSchema).optional(),
    latestHandoffId: idSchema.nullable().optional(),
    lastActiveAt: dateTimeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const forbiddenKeys = [
      "topicState",
      "state",
      "lifecycleStatus",
      "projectLifecycleStatus",
      "projectStatus",
      "projectState",
      "lifecycle",
    ];

    for (const key of forbiddenKeys) {
      if (key in value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "handoff updates cannot change topic state or project lifecycle",
        });
      }
    }
  });

export const handoffUpdatePayloadSchema = handoffUpdateSchema;
