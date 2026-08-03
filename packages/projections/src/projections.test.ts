import { describe, expect, it } from "vitest";
import type { ProjectProjection } from "@flowcontext/domain";
import {
  buildDailyProjection,
  parseFrontmatter,
  parseProjectProjection,
} from "./index.ts";

const indexText = `# Alpha\n\n一个用于验证最小流程的项目。\n`;
const statusText = `---\nstatus: active\nmanaged_by: obsidian-project-context-sync\n---\n# Alpha status\n## 当前阶段\n正在构建最小闭环。\n## 下一步最小动作\n- 验证 Alpha 最小流程\n`;

describe("Obsidian projection parsers", () => {
  it("reads lifecycle and next action from managed status", () => {
    const projection = parseProjectProjection({
      indexText,
      statusText,
      sourcePath: "03_项目/10_进行中/Alpha",
    });

    expect(projection.lifecycleStatus).toBe("active");
    expect(projection.nextAction).toBe("验证 Alpha 最小流程");
    expect(projection.title).toBe("Alpha");
    expect(projection.summary).toBe("正在构建最小闭环。");
    expect(projection.sourcePath).toBe("03_项目/10_进行中/Alpha");
  });

  it("rejects an unmanaged status as lifecycle authority", () => {
    expect(() =>
      parseProjectProjection({
        indexText,
        statusText: statusText.replace("managed_by: obsidian-project-context-sync", "managed_by: other"),
        sourcePath: "Alpha",
      }),
    ).toThrow("managed project status required");
  });

  it("parses quoted and inline-commented frontmatter without changing source text", () => {
    expect(parseFrontmatter("---\nstatus: \"paused\" # lifecycle\nmanaged_by: obsidian-project-context-sync\n---\nbody")).toEqual({
      status: "paused",
      managed_by: "obsidian-project-context-sync",
    });
  });

  it("accepts an empty next action when the managed section has no list item", () => {
    const projection = parseProjectProjection({
      indexText,
      statusText: statusText.replace("- 验证 Alpha 最小流程", "暂无安排"),
      sourcePath: "中文/Alpha",
    });
    expect(projection.nextAction).toBe("");
  });

  it("builds a daily projection from parsed projects and optional reports", () => {
    const project: ProjectProjection = parseProjectProjection({
      indexText,
      statusText,
      sourcePath: "03_项目/10_进行中/Alpha",
    });
    const projection = buildDailyProjection({
      date: "2026-08-02",
      dailyLens: "今天先完成最小验证。",
      projects: [project],
      macReport: "Mac 完成 API 验证。",
      windowsReport: null,
    });

    expect(projection).toEqual({
      date: "2026-08-02",
      dailyLens: "今天先完成最小验证。",
      projects: [project],
      macReport: "Mac 完成 API 验证。",
      windowsReport: null,
    });
  });

  it("normalizes missing reports to null and validates the date", () => {
    expect(buildDailyProjection({ date: "2026-08-02", projects: [] }).macReport).toBeNull();
    expect(buildDailyProjection({ date: "2026-08-02", projects: [] }).windowsReport).toBeNull();
    expect(() => buildDailyProjection({ date: "2026-02-30", projects: [] })).toThrow();
  });
});
