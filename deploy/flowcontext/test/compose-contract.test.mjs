import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const serviceBlock = (compose, service) => {
  const match = compose.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z]|^volumes:|^networks:|(?![\\s\\S]))`, "m"));
  assert.ok(match, `missing ${service} service`);
  return match[1];
};

test("compose keeps database and API private behind Caddy", async () => {
  const compose = await read("docker-compose.yml");

  assert.match(compose, /^\s*postgres:\s*$/m);
  assert.match(compose, /^\s*api:\s*$/m);
  assert.match(compose, /^\s*caddy:\s*$/m);
  assert.match(compose, /caddy:[\s\S]*?ports:\s*\n\s*- "80:80"\s*\n\s*- "443:443"/);
  assert.doesNotMatch(serviceBlock(compose, "postgres"), /^\s*ports:/m);
  assert.doesNotMatch(serviceBlock(compose, "api"), /^\s*ports:/m);
  assert.match(compose, /flowcontext_internal:\s*\n\s*internal: true/);
  assert.match(compose, /flowcontext_edge:/);
  assert.match(serviceBlock(compose, "caddy"), /- flowcontext_edge/);
  for (const service of ["postgres", "api"]) {
    const networkBlock = serviceBlock(compose, service);
    assert.match(networkBlock, /- flowcontext_internal/);
    assert.doesNotMatch(networkBlock, /flowcontext_edge/);
  }
});

test("compose has persistent, healthy, restarting services without embedded secrets", async () => {
  const compose = await read("docker-compose.yml");

  for (const service of ["postgres", "api", "caddy"]) {
    assert.match(compose, new RegExp(`${service}:\\s*[\\s\\S]*?restart: unless-stopped`));
  }
  assert.match(compose, /postgres_data:/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /pnpm --filter @flowcontext\/api migrate/);
  assert.doesNotMatch(compose, /^(POSTGRES_PASSWORD|FLOWCONTEXT_OWNER_ID):\s*(?!\$\{)\S+/m);
  const caddy = serviceBlock(compose, "caddy");
  assert.doesNotMatch(caddy, /env_file:/);
  assert.doesNotMatch(caddy, /POSTGRES_PASSWORD/);
  assert.match(caddy, /FLOWCONTEXT_PUBLIC_URL: \$\{FLOWCONTEXT_PUBLIC_URL/);
});

test("operator environment contract contains names only and deployment files stay local", async () => {
  const [example, ignore, caddy] = await Promise.all([
    read(".env.example"),
    read(".gitignore"),
    read("Caddyfile"),
  ]);

  for (const key of ["POSTGRES_PASSWORD", "FLOWCONTEXT_OWNER_ID", "FLOWCONTEXT_PUBLIC_URL", "ACME_EMAIL"]) {
    assert.match(example, new RegExp(`^${key}=$`, "m"));
  }
  assert.match(ignore, /^\.env$/m);
  assert.match(caddy, /http:\/\/{env\.FLOWCONTEXT_PUBLIC_URL}/);
  assert.match(caddy, /https:\/\/{env\.FLOWCONTEXT_PUBLIC_URL}/);
  assert.match(caddy, /reverse_proxy api:8080/);
});

test("operator scripts validate device IDs and keep admin commands inside the private API", async () => {
  const [preflight, deploy, enroll, revoke, readme] = await Promise.all([
    read("preflight.sh"),
    read("deploy.sh"),
    read("create-enrollment.sh"),
    read("revoke-device.sh"),
    read("README.md"),
  ]);

  assert.match(preflight, /docker compose/);
  assert.match(preflight, /SSH_CONNECTION/);
  assert.match(preflight, /FLOWCONTEXT_PUBLIC_URL/);
  assert.match(preflight, /stat/);
  assert.match(preflight, /0600/);
  assert.match(preflight, /docker compose --env-file \.env config/);
  assert.match(preflight, /ss -ltn/);
  assert.match(preflight, /ss -ltnH/);
  assert.match(preflight, /TCP 80 or 443 already has a listener/);
  assert.match(preflight, /grep -q '\.'/);
  assert.match(deploy, /\[ -f "\$root_dir\/\.env" \]/);
  assert.match(deploy, /stat -c/);
  assert.match(deploy, /\. "\$root_dir\/\.env"/);
  assert.match(deploy, /FLOWCONTEXT_PUBLIC_URL is required/);
  assert.match(deploy, /docker compose --env-file \.env config/);
  assert.match(deploy, /docker compose --env-file \.env up -d --build --wait/);
  assert.match(deploy, /curl .*https:\/\/\$FLOWCONTEXT_PUBLIC_URL\/healthz/);
  assert.match(deploy, /printf 'deployed: https:\/\/%s/);
  for (const script of [enroll, revoke]) {
    assert.match(script, /UUID_PATTERN=/);
    assert.match(script, /docker compose .*exec .*api/);
  }
  assert.match(enroll, /enrollment create --device-id "\$device_id"/);
  assert.match(revoke, /device revoke/);
  assert.match(readme, /(域名\/DNS|domain\/DNS)/i);
  assert.match(readme, /0600/);
});
