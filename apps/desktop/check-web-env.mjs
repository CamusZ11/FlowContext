// Packaging guard: a production desktop bundle without the self-hosted API
// configuration builds fine but only renders "FlowContext 尚未配置" at
// runtime. Fail the build instead of shipping an unconfigured shell.
// The values live in apps/web/.env (gitignored); see the repo-root
// .env.example for the required keys.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../web/.env", import.meta.url));

let env = "";
try {
  env = readFileSync(envPath, "utf8");
} catch {
  console.error(
    "FlowContext desktop packaging requires apps/web/.env with VITE_FLOWCONTEXT_PROVIDER and VITE_FLOWCONTEXT_API_URL (see .env.example).",
  );
  process.exit(1);
}

const hasProvider = /^VITE_FLOWCONTEXT_PROVIDER=self-hosted$/m.test(env);
const hasApiUrl = /^VITE_FLOWCONTEXT_API_URL=\S+$/m.test(env);
if (!hasProvider || !hasApiUrl) {
  console.error(
    "apps/web/.env must set VITE_FLOWCONTEXT_PROVIDER=self-hosted and a non-empty VITE_FLOWCONTEXT_API_URL before packaging the desktop app.",
  );
  process.exit(1);
}
