import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSnapshot,
  discoverProjects,
  loadConfig,
  readReports,
  writeSnapshotAtomic,
} from "./index.ts";

const packageRoot = resolve(import.meta.dirname, "../../..");
const fixtureVault = join(packageRoot, "tests/fixtures/vault");
const fixtureReports = join(packageRoot, "tests/fixtures/reports");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("projection-sync", () => {
  it("discovers only managed project lifecycle directories", async () => {
    const rows = await discoverProjects(fixtureVault);
    expect(rows.map((row) => row.relativePath)).toEqual(["03_项目/10_进行中/Alpha"]);
    expect(rows[0]?.projection.lifecycleStatus).toBe("active");
  });

  it("uses configured roots instead of macOS constants", () => {
    const config = loadConfig({ vaultRoot: "F:\\All_in_Context", reportsRoot: "D:\\reports", deviceId: "win", timezone: "Asia/Shanghai" });
    expect(config.vaultRoot).toBe("F:\\All_in_Context");
    expect(config.reportsRoot).toBe("D:\\reports");
  });

  it("rejects config values that try to carry credentials", () => {
    expect(() => loadConfig({ vaultRoot: "/vault", reportsRoot: "/reports", deviceId: "mac", timezone: "Asia/Shanghai", token: "secret" })).toThrow("unsupported config key");
  });

  it("reads Mac and Windows report sections while allowing missing reports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flowcontext-reports-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "codex-daily-report-2026-08-02.md"), "# Report\n## Mac\nMac 完成。\n## Windows\nWindows 完成。\n", "utf8");
    await writeFile(join(directory, "codex-daily-report-2026-08-01.md"), "# Stale\n## Mac\n旧报告。\n", "utf8");
    const reports = await readReports(directory, "2026-08-02");
    expect(reports.macReport).toBe("Mac 完成。");
    expect(reports.windowsReport).toBe("Windows 完成。");
    expect(await readReports(directory, "2026-08-03")).toEqual({ macReport: null, windowsReport: null, files: [] });
  });

  it("builds a complete snapshot with projects and daily projection", async () => {
    const config = loadConfig({ vaultRoot: fixtureVault, reportsRoot: fixtureReports, deviceId: "mac", timezone: "Asia/Shanghai" });
    const snapshot = await buildSnapshot({ config, date: "2026-08-01", dailyLens: "聚焦 Alpha。" });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.projects.map((project) => project.projectKey)).toEqual(["Alpha"]);
    expect(snapshot.projects[0]?.sourcePath).toBe("03_项目/10_进行中/Alpha");
    expect(snapshot.projects[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.daily.date).toBe("2026-08-01");
    expect(snapshot.daily.projects).toHaveLength(1);
    expect(snapshot.daily.macReport).toBe("完成 Alpha 投影解析测试。");
    expect(JSON.stringify(snapshot)).not.toMatch(/token|service_role|password/i);
  });

  it("writes snapshots by temporary file and atomic rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flowcontext-snapshot-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "nested", "snapshot.json");
    await writeSnapshotAtomic(output, { schemaVersion: 1, date: "2026-08-02", projects: [], daily: { date: "2026-08-02", dailyLens: "", projects: [], macReport: null, windowsReport: null } });
    const saved = JSON.parse(await readFile(output, "utf8")) as { schemaVersion: number };
    expect(saved.schemaVersion).toBe(1);
    expect(await readFile(output + ".tmp", "utf8").catch(() => null)).toBeNull();
  });

  it("does not mutate the source fixture during discovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flowcontext-vault-"));
    temporaryDirectories.push(directory);
    await cp(fixtureVault, directory, { recursive: true });
    const before = await readFile(join(directory, "03_项目/10_进行中/Alpha/status.md"), "utf8");
    await discoverProjects(directory);
    expect(await readFile(join(directory, "03_项目/10_进行中/Alpha/status.md"), "utf8")).toBe(before);
  });

  it("keeps the logical project key and stable id when lifecycle directories move", async () => {
    const firstVault = await mkdtemp(join(tmpdir(), "flowcontext-vault-before-"));
    const secondVault = await mkdtemp(join(tmpdir(), "flowcontext-vault-after-"));
    temporaryDirectories.push(firstVault, secondVault);
    await cp(fixtureVault, firstVault, { recursive: true });
    await cp(fixtureVault, secondVault, { recursive: true });
    await mkdir(join(secondVault, "03_项目/20_等待暂停"), { recursive: true });
    await rename(
      join(secondVault, "03_项目/10_进行中/Alpha"),
      join(secondVault, "03_项目/20_等待暂停/Alpha"),
    );

    const before = await buildSnapshot({
      config: loadConfig({ vaultRoot: firstVault, reportsRoot: fixtureReports, deviceId: "mac", timezone: "Asia/Shanghai" }),
      date: "2026-08-01",
    });
    const after = await buildSnapshot({
      config: loadConfig({ vaultRoot: secondVault, reportsRoot: fixtureReports, deviceId: "mac", timezone: "Asia/Shanghai" }),
      date: "2026-08-01",
    });

    expect(before.projects[0]?.projectKey).toBe("Alpha");
    expect(after.projects[0]?.projectKey).toBe("Alpha");
    expect(after.projects[0]?.id).toBe(before.projects[0]?.id);
    expect(after.projects[0]?.sourcePath).toBe("03_项目/20_等待暂停/Alpha");
  });

  it("fails closed when the same logical project key exists in two lifecycle roots", async () => {
    const duplicateVault = await mkdtemp(join(tmpdir(), "flowcontext-vault-duplicate-"));
    temporaryDirectories.push(duplicateVault);
    await cp(fixtureVault, duplicateVault, { recursive: true });
    const pausedRoot = join(duplicateVault, "03_项目/20_等待暂停");
    await mkdir(pausedRoot, { recursive: true });
    await cp(
      join(duplicateVault, "03_项目/10_进行中/Alpha"),
      join(pausedRoot, "Alpha"),
      { recursive: true },
    );

    await expect(discoverProjects(duplicateVault)).rejects.toThrow(/duplicate project key.*Alpha/i);
  });
});
