#!/usr/bin/env node
import { lstat, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(root, "integrations");
const defaultSkillsRoot = process.env.FLOWCONTEXT_SKILLS_ROOT || "/Users/camus/.agents/skills";
const definitions = [
  ["flowcontext-session", resolve(sourceRoot, "flowcontext-session")],
  ["generating-handoff", resolve(sourceRoot, "generating-handoff")],
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || !args.has("--apply");
const apply = args.has("--apply");
const confirmed = args.has("--confirmed");
const skillsRootArg = valueAfter("--skills-root");
const skillsRoot = resolve(skillsRootArg || defaultSkillsRoot);

if (args.has("--help")) {
  console.log("usage: install-integrations.mjs [--dry-run] [--apply --confirmed] [--skills-root DIR]");
  process.exit(0);
}
if (apply && !confirmed) {
  console.error("apply requires --confirmed");
  process.exit(2);
}

const plans = [];
for (const [name, source] of definitions) {
  const target = resolve(skillsRoot, name);
  const state = await inspectTarget(target, source);
  plans.push({ name, source, target, state });
  console.log(`${name}: ${state.kind} source=${source} target=${target} action=${state.action}`);
}

const conflicts = plans.filter((plan) => plan.state.conflict);
if (conflicts.length > 0) {
  console.error(`installer stopped: ${conflicts.length} unmanaged target conflict(s)`);
  process.exit(2);
}
if (dryRun) {
  console.log("dry-run only; no user-level links changed");
  process.exit(0);
}

for (const plan of plans) {
  if (plan.state.kind === "missing") {
    await symlink(plan.source, plan.target, "dir");
  }
}
console.log("integration links applied");

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function inspectTarget(target, source) {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) {
      const link = resolve(dirname(target), await readlink(target));
      if (link === source) return { kind: "managed-link", action: "already-points-to-FlowContext", conflict: false };
      return { kind: "external-link", action: "stop-and-ask", conflict: true };
    }
    return { kind: stats.isDirectory() ? "directory" : "file", action: "stop-and-ask", conflict: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing", action: "create-link", conflict: false };
    throw error;
  }
}
