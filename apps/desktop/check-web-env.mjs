// Packaging guard: a production desktop bundle without the self-hosted API
// configuration builds fine but only renders "FlowContext 尚未配置" at
// runtime. Fail the build instead of shipping an unconfigured shell.
// The values live in apps/web/.env (gitignored); see the repo-root
// .env.example for the required keys.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../web/.env", import.meta.url));

export function validateDesktopEnv(env, { allowHttpFixture = false } = {}) {
  const provider = /^VITE_FLOWCONTEXT_PROVIDER=self-hosted$/m.test(env);
  const rawUrl = env.match(/^VITE_FLOWCONTEXT_API_URL=(\S+)$/m)?.[1];
  if (!provider || !rawUrl) {
    return "apps/web/.env must set VITE_FLOWCONTEXT_PROVIDER=self-hosted and a non-empty VITE_FLOWCONTEXT_API_URL before packaging the desktop app.";
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawUrl);
  } catch {
    return "VITE_FLOWCONTEXT_API_URL must be an absolute HTTPS URL.";
  }
  if (apiUrl.protocol === "https:") return null;
  if (allowHttpFixture && apiUrl.protocol === "http:" && apiUrl.hostname === "127.0.0.1") return null;
  return "Release desktop packaging accepts only HTTPS APIs; HTTP is limited to an explicit 127.0.0.1 test fixture.";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let env = "";
  try {
    env = readFileSync(envPath, "utf8");
  } catch {
    console.error(
      "FlowContext desktop packaging requires apps/web/.env with VITE_FLOWCONTEXT_PROVIDER and VITE_FLOWCONTEXT_API_URL (see .env.example).",
    );
    process.exit(1);
  }
  const error = validateDesktopEnv(env);
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
