import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sectionBody } from "@flowcontext/projections";

export interface DailyReports {
  macReport: string | null;
  windowsReport: string | null;
  files: string[];
}

export async function readReports(reportsRoot: string, date: string): Promise<DailyReports> {
  let entries;
  try {
    entries = await readdir(reportsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return { macReport: null, windowsReport: null, files: [] };
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md") && entry.name.includes(date))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const mac: string[] = [];
  const windows: string[] = [];
  for (const file of files) {
    const text = (await readFile(join(reportsRoot, file), "utf8")).trim();
    if (!text) continue;
    const headingMac = sectionBody(text, "Mac").trim();
    const headingWindows = sectionBody(text, "Windows").trim();
    const name = file.toLowerCase();
    if (headingMac) mac.push(headingMac);
    if (headingWindows) windows.push(headingWindows);
    if (!headingMac && !headingWindows) {
      if (/(?:^|[-_.])mac(?:[-_.]|$)/i.test(name)) mac.push(text);
      else if (/(?:^|[-_.])windows?(?:[-_.]|$)/i.test(name)) windows.push(text);
    }
  }
  return {
    macReport: joinReports(mac),
    windowsReport: joinReports(windows),
    files,
  };
}

function joinReports(reports: readonly string[]): string | null {
  const value = reports.filter(Boolean).join("\n\n").trim();
  return value || null;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
