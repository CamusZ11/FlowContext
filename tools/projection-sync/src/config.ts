import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface ProjectionSyncConfig {
  vaultRoot: string;
  reportsRoot: string;
  deviceId: string;
  timezone: string;
}

const CONFIG_KEYS = new Set(["vaultRoot", "reportsRoot", "deviceId", "timezone"]);

export function loadConfig(source: string | Readonly<Record<string, unknown>> = "flowcontext.config.json"): ProjectionSyncConfig {
  const value = typeof source === "string" ? readJson(source) : source;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("projection config must be a JSON object");
  }
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`unsupported config key: ${key}`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const config = {
    vaultRoot: requiredString(record.vaultRoot, "vaultRoot"),
    reportsRoot: requiredString(record.reportsRoot, "reportsRoot"),
    deviceId: requiredString(record.deviceId, "deviceId"),
    timezone: requiredString(record.timezone, "timezone"),
  };
  return config;
}

function readJson(path: string): unknown {
  const candidate = resolveConfigPath(path);
  try {
    return JSON.parse(readFileSync(candidate, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`unable to read projection config: ${candidate}`, { cause: error });
  }
}

function resolveConfigPath(path: string): string {
  if (isAbsolute(path) || existsSync(path)) return path;
  let directory = resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, path);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}
