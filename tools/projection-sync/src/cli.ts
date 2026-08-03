import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { buildSnapshot, validateSnapshot, writeSnapshotAtomic } from "./buildSnapshot.ts";

export async function runCli(argv: readonly string[]): Promise<void> {
  const [command, ...rawRest] = argv;
  const rest = rawRest[0] === "--" ? rawRest.slice(1) : rawRest;
  if (command !== "build") throw new Error("usage: projection-sync build --config FILE --date YYYY-MM-DD --output FILE [--dry-run]");
  const options = parseOptions(rest);
  const config = loadConfig(options.config ?? "flowcontext.config.json");
  if (!options.date || !options.output) throw new Error("build requires --date and --output");
  const snapshot = await buildSnapshot({ config, date: options.date });
  validateSnapshot(snapshot);
  await writeSnapshotAtomic(options.output, snapshot);
  process.stdout.write(`${options.dryRun ? "dry-run" : "built"}: ${options.output}\n`);
}

function parseOptions(argv: readonly string[]): { config?: string; date?: string; output?: string; dryRun: boolean } {
  const options: { config?: string; date?: string; output?: string; dryRun: boolean } = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2) as "config" | "date" | "output";
    if (key !== "config" && key !== "date" && key !== "output") throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
    options[key] = value;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "projection-sync failed"}\n`);
    process.exitCode = 1;
  });
}
