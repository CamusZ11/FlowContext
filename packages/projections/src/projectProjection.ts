import {
  projectProjectionSchema,
  type ProjectProjection,
} from "@flowcontext/domain";
import { parseFrontmatter } from "./frontmatter.ts";
import { readFirstListItem, readFirstParagraph, readHeading } from "./sections.ts";

export interface ProjectProjectionInput {
  indexText: string;
  statusText: string;
  sourcePath: string;
  /** Stable path below a lifecycle root; defaults to sourcePath for callers that do not scan a Vault. */
  projectKey?: string;
}

export function parseProjectProjection(input: ProjectProjectionInput): ProjectProjection {
  const sourcePath = input.sourcePath.trim();
  if (!sourcePath) throw new Error("project source path required");
  const projectKey = input.projectKey?.trim() || sourcePath;
  if (!projectKey) throw new Error("project key required");
  const frontmatter = parseFrontmatter(input.statusText);
  if (frontmatter.managed_by !== "obsidian-project-context-sync") {
    throw new Error("managed project status required");
  }
  const lifecycleStatus = frontmatter.status;
  if (typeof lifecycleStatus !== "string") {
    throw new Error("managed project status must declare lifecycle status");
  }

  const title = readHeading(input.indexText, 1) || readHeading(input.statusText, 1) || sourcePath.split(/[\\/]/).pop() || sourcePath;
  return projectProjectionSchema.parse({
    projectKey,
    title,
    lifecycleStatus,
    summary: readFirstParagraph(input.statusText, "当前阶段"),
    nextAction: readFirstListItem(input.statusText, "下一步最小动作"),
    sourcePath,
  });
}
