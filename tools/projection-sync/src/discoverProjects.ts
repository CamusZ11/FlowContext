import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ProjectProjection } from "@flowcontext/domain";
import { parseFrontmatter, parseProjectProjection } from "@flowcontext/projections";

export interface DiscoveredProject {
  relativePath: string;
  projectKey: string;
  absolutePath: string;
  indexPath: string;
  statusPath: string;
  indexText: string;
  statusText: string;
  projection: ProjectProjection;
}

const LIFECYCLE_ROOTS = [
  "03_项目/00_收集箱",
  "03_项目/10_进行中",
  "03_项目/20_等待暂停",
  "03_项目/80_已完成",
  "03_项目/90_归档",
] as const;

export async function discoverProjects(vaultRoot: string): Promise<DiscoveredProject[]> {
  const discovered: DiscoveredProject[] = [];
  for (const lifecycleRoot of LIFECYCLE_ROOTS) {
    const lifecycleDirectory = join(vaultRoot, ...lifecycleRoot.split("/"));
    await visit(lifecycleDirectory, vaultRoot, lifecycleDirectory, discovered);
  }
  const sorted = discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-Hans"));
  const seen = new Map<string, DiscoveredProject>();
  for (const project of sorted) {
    const previous = seen.get(project.projectKey);
    if (previous) {
      throw new Error(
        `duplicate project key '${project.projectKey}' at ${previous.relativePath} and ${project.relativePath}`,
      );
    }
    seen.set(project.projectKey, project);
  }
  return sorted;
}

async function visit(
  directory: string,
  vaultRoot: string,
  lifecycleDirectory: string,
  discovered: DiscoveredProject[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return;
    throw error;
  }

  const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const indexPath = join(directory, "index.md");
  const statusPath = join(directory, "status.md");
  if (fileNames.has("index.md") && fileNames.has("status.md")) {
    const [indexText, statusText] = await Promise.all([readFile(indexPath, "utf8"), readFile(statusPath, "utf8")]);
    const metadata = parseFrontmatter(statusText);
    if (metadata.managed_by === "obsidian-project-context-sync") {
      const relativePath = normalizeRelativePath(relative(vaultRoot, directory));
      const projectKey = normalizeRelativePath(relative(lifecycleDirectory, directory));
      if (!projectKey || projectKey === ".") throw new Error(`managed project must be below lifecycle root: ${relativePath}`);
      discovered.push({
        relativePath,
        projectKey,
        absolutePath: directory,
        indexPath,
        statusPath,
        indexText,
        statusText,
        projection: parseProjectProjection({ indexText, statusText, sourcePath: relativePath, projectKey }),
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    await visit(join(directory, entry.name), vaultRoot, lifecycleDirectory, discovered);
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
