import { mkdir, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { dailyProjectionSchema, isoDateSchema, projectProjectionSchema, type DailyProjection, type ProjectProjection } from "@flowcontext/domain";
import { buildDailyProjection } from "@flowcontext/projections";
import type { ProjectionSyncConfig } from "./config.ts";
import { discoverProjects } from "./discoverProjects.ts";
import { readReports } from "./readReports.ts";

export interface ProjectionSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  date: string;
  deviceId: string;
  projects: ProjectProjection[];
  daily: DailyProjection;
}

export interface BuildSnapshotInput {
  config: ProjectionSyncConfig;
  date: string;
  dailyLens?: string | null;
}

export async function buildSnapshot(input: BuildSnapshotInput): Promise<ProjectionSnapshot> {
  isoDateSchema.parse(input.date);
  const [projects, reports] = await Promise.all([
    discoverProjects(input.config.vaultRoot),
    readReports(input.config.reportsRoot, input.date),
  ]);
  const projectProjections = projects.map((project) => ({
    ...project.projection,
    id: project.projection.id ?? stableProjectId(project.projection.projectKey),
  }));
  const daily = buildDailyProjection({
    date: input.date,
    dailyLens: input.dailyLens ?? "",
    projects: projectProjections,
    macReport: reports.macReport,
    windowsReport: reports.windowsReport,
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    date: input.date,
    deviceId: input.config.deviceId,
    projects: projectProjections,
    daily,
  };
}

/** Stable UUIDv5-like IDs let a read-only Vault scan reconcile by identity. */
function stableProjectId(projectKey: string): string {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const digest = createHash("sha1").update(namespace).update(projectKey, "utf8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function writeSnapshotAtomic(outputPath: string, snapshot: ProjectionSnapshot | Record<string, unknown>): Promise<void> {
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await import("node:fs/promises").then(({ unlink }) => unlink(temporaryPath).catch(() => undefined));
    throw error;
  }
}

export function validateSnapshot(value: unknown): ProjectionSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("projection snapshot must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || typeof row.generatedAt !== "string" || typeof row.date !== "string" || typeof row.deviceId !== "string" || !Array.isArray(row.projects)) {
    throw new Error("projection snapshot is incomplete");
  }
  isoDateSchema.parse(row.date);
  const projects = row.projects.map((project) => projectProjectionSchema.parse(project));
  const daily = dailyProjectionSchema.parse(row.daily);
  if (daily.date !== row.date) throw new Error("daily projection date must match snapshot date");
  return { schemaVersion: 1, generatedAt: row.generatedAt, date: row.date, deviceId: row.deviceId, projects, daily };
}
