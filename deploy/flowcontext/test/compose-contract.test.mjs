import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const serviceBlock = (compose, service) => {
  const match = compose.match(new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z]|^volumes:|^networks:|(?![\\s\\S]))`, "m"));
  assert.ok(match, `missing ${service} service`);
  return match[1];
};

test("compose keeps database and API private while Caddy joins a non-internal edge network for loopback publishing", async () => {
  const compose = await read("docker-compose.yml");

  assert.match(compose, /^\s*postgres:\s*$/m);
  assert.match(compose, /^\s*api:\s*$/m);
  assert.match(compose, /^\s*caddy:\s*$/m);
  assert.match(compose, /caddy:[\s\S]*?ports:\s*\n\s*- "127\.0\.0\.1:18080:80"/);
  assert.doesNotMatch(compose, /(^|\n)\s*- "(?:0\.0\.0\.0:)?(?:80|443):/);
  assert.doesNotMatch(serviceBlock(compose, "postgres"), /^\s*ports:/m);
  assert.doesNotMatch(serviceBlock(compose, "api"), /^\s*ports:/m);
  assert.match(compose, /flowcontext_internal:\s*\n\s*internal: true/);
  assert.match(compose, /flowcontext_edge:\s*\n\s*internal: false/);
  for (const service of ["postgres", "api"]) {
    const networkBlock = serviceBlock(compose, service);
    assert.match(networkBlock, /- flowcontext_internal/);
    assert.doesNotMatch(networkBlock, /flowcontext_edge/);
  }
  const caddy = serviceBlock(compose, "caddy");
  assert.match(caddy, /networks:\s*\n\s*- flowcontext_internal\s*\n\s*- flowcontext_edge/);
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
  assert.doesNotMatch(caddy, /FLOWCONTEXT_PUBLIC_URL/);
});

test("operator environment contract contains names only and deployment files stay local", async () => {
  const [example, ignore, caddy] = await Promise.all([
    read(".env.example"),
    read(".gitignore"),
    read("Caddyfile"),
  ]);

  for (const key of ["POSTGRES_PASSWORD", "FLOWCONTEXT_OWNER_ID", "FLOWCONTEXT_PUBLIC_URL"]) {
    assert.match(example, new RegExp(`^${key}=$`, "m"));
  }
  assert.match(ignore, /^\.env$/m);
  assert.match(caddy, /^:80 \{/m);
  assert.match(caddy, /reverse_proxy api:8080/);
  assert.doesNotMatch(caddy, /tls\s|https:\/\//);
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
  assert.match(preflight, /nginx/);
  assert.match(preflight, /127\.0\.0\.1:18080/);
  assert.match(deploy, /\[ -f "\$root_dir\/\.env" \]/);
  assert.match(deploy, /stat -c/);
  assert.match(deploy, /FLOWCONTEXT_PUBLIC_URL is required/);
  for (const script of [preflight, deploy]) {
    assert.doesNotMatch(script, /\. "\$root_dir\/\.env"/);
    assert.match(script, /\. "\$root_dir\/env\.sh"/);
    assert.match(script, /load_flowcontext_env "\$root_dir\/\.env"/);
  }
  assert.match(deploy, /docker compose --env-file \.env config/);
  assert.match(deploy, /docker compose --env-file \.env up -d --build --wait/);
  assert.match(deploy, /curl .*http:\/\/127\.0\.0\.1:18080\/healthz/);
  assert.match(deploy, /printf 'deployed: https:\/\/%s/);
  for (const script of [enroll, revoke]) {
    assert.match(script, /UUID_PATTERN=/);
    assert.match(script, /docker compose .*exec .*api/);
  }
  assert.match(enroll, /enrollment create --device-id "\$device_id"/);
  assert.match(revoke, /device revoke/);
  assert.match(readme, /flowcontext\.zkabi\.cn/);
  assert.match(readme, /Nginx/);
  assert.match(readme, /0600/);
});

test("preflight permits only the already-running managed loopback Caddy", async () => {
  const preflight = await read("preflight.sh");

  assert.match(preflight, /docker compose --env-file \.env ps --status running --services/);
  assert.match(preflight, /grep -Fx caddy/);
  assert.match(preflight, /docker compose --env-file \.env port caddy 80/);
  assert.match(preflight, /\[ "\$caddy_port" = "127\.0\.0\.1:18080" \]/);
  assert.match(preflight, /\$4 != "127\.0\.0\.1:18080"/);
  assert.match(preflight, /foreign or non-loopback listener/);
});

test("Nginx template is limited to the approved host and loopback proxy", async () => {
  const [site, installer] = await Promise.all([
    read("nginx/flowcontext.zkabi.cn.conf"),
    read("install-nginx-site.sh"),
  ]);

  assert.match(site, /server_name flowcontext\.zkabi\.cn;/);
  assert.match(site, /proxy_pass http:\/\/127\.0\.0\.1:18080;/);
  assert.match(site, /proxy_buffering off;/);
  assert.match(site, /proxy_http_version 1\.1;/);
  assert.match(site, /Upgrade \$http_upgrade/);
  assert.match(site, /\.well-known\/acme-challenge/);
  assert.doesNotMatch(site, /ssl_certificate(?:_key)?\s/);
  assert.doesNotMatch(site, /server_name\s+(?!flowcontext\.zkabi\.cn;)/);
  assert.match(installer, /nginx -t/);
  assert.match(installer, /sites-available/);
  assert.match(installer, /sites-enabled/);
  assert.match(installer, /trap 'rollback' EXIT/);
  assert.match(installer, /nginx -s reload \|\| fail/);
  assert.match(installer, /enabled_created=1/);
  assert.match(installer, /available_created=1/);
  assert.match(installer, /\[ "\$enabled_created" -eq 0 \] \|\| rm -f "\$enabled"/);
  assert.match(installer, /\[ "\$available_created" -eq 0 \] \|\| rm -f "\$available"/);
  assert.match(installer, /\[ ! -e "\$available" \] && \[ ! -L "\$available" \]/);
  assert.match(installer, /\[ ! -e "\$enabled" \] && \[ ! -L "\$enabled" \]/);
  assert.match(installer, /trap 'abort' HUP INT TERM/);
  assert.match(installer, /abort\(\) \{[\s\S]*rollback[\s\S]*exit 1/);
});

test("Nginx installer removes only its own available file when link creation fails", async (t) => {
  if (spawnSync("docker", ["version"], { stdio: "ignore" }).status !== 0) {
    t.skip("Docker is required for the installer behavior test");
    return;
  }
  const fakeBin = await mkdtemp(join(tmpdir(), "flowcontext-nginx-fake-bin-"));
  try {
    const failLink = join(fakeBin, "ln");
    await writeFile(failLink, "#!/bin/sh\nexit 1\n");
    await chmod(failLink, 0o755);
    const deployRoot = new URL("..", import.meta.url).pathname;
    const result = spawnSync("docker", [
      "run", "--rm",
      "-v", `${deployRoot}:/work:ro`,
      "-v", `${fakeBin}:/fake:ro`,
      "alpine:3.20",
      "sh", "-c",
      "mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled; PATH=/fake:$PATH /work/install-nginx-site.sh --http-only; status=$?; if [ ! -e /etc/nginx/sites-available/flowcontext.zkabi.cn ] && [ ! -L /etc/nginx/sites-available/flowcontext.zkabi.cn ] && [ ! -e /etc/nginx/sites-enabled/flowcontext.zkabi.cn ] && [ ! -L /etc/nginx/sites-enabled/flowcontext.zkabi.cn ]; then echo rolled-back; fi; exit $status",
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /rolled-back/);
  } finally {
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("Nginx installer refuses and preserves an existing dangling site symlink", async (t) => {
  if (spawnSync("docker", ["version"], { stdio: "ignore" }).status !== 0) {
    t.skip("Docker is required for the installer behavior test");
    return;
  }
  const deployRoot = new URL("..", import.meta.url).pathname;
  const result = spawnSync("docker", [
    "run", "--rm",
    "-v", `${deployRoot}:/work:ro`,
    "alpine:3.20",
    "sh", "-c",
    "mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled; ln -s /missing /etc/nginx/sites-available/flowcontext.zkabi.cn; PATH=/nonexistent:$PATH /work/install-nginx-site.sh --http-only; status=$?; if [ -L /etc/nginx/sites-available/flowcontext.zkabi.cn ] && [ \"$(readlink /etc/nginx/sites-available/flowcontext.zkabi.cn)\" = /missing ]; then echo preserved-dangling-link; fi; exit $status",
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to replace an existing Nginx site/);
  assert.match(result.stdout, /preserved-dangling-link/);
});

test("strict environment loader accepts only the complete literal whitelist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowcontext-env-contract-"));
  const envPath = join(directory, ".env");
  try {
    await writeFile(envPath, [
      "POSTGRES_PASSWORD=literal-value",
      "FLOWCONTEXT_OWNER_ID=00000000-0000-4000-8000-000000000000",
      "FLOWCONTEXT_PUBLIC_URL=flowcontext.example.com",
    ].join("\n"));
    const helper = new URL("env.sh", root).pathname;
    const result = spawnSync("/bin/sh", ["-c", `. "${helper}"; load_flowcontext_env "$1"; printf '%s' "$FLOWCONTEXT_PUBLIC_URL"`, "--", envPath], { encoding: "utf8" });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "flowcontext.example.com");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict environment loader rejects executable syntax, unknown, duplicate, and missing keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowcontext-env-contract-"));
  const helper = new URL("env.sh", root).pathname;
  try {
    for (const invalid of [
      "POSTGRES_PASSWORD=$(false)",
      "POSTGRES_PASSWORD=`false`",
      "POSTGRES_PASSWORD=value\nPOSTGRES_PASSWORD=again",
      "UNEXPECTED=value",
      "POSTGRES_PASSWORD=value\nFLOWCONTEXT_OWNER_ID=id",
    ]) {
      const envPath = join(directory, `${Math.random()}.env`);
      await writeFile(envPath, invalid);
      const result = spawnSync("/bin/sh", ["-c", `. "${helper}"; load_flowcontext_env "$1"`, "--", envPath], { encoding: "utf8" });
      assert.notEqual(result.status, 0, invalid);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict environment loader never executes command substitution text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowcontext-env-contract-"));
  const envPath = join(directory, ".env");
  const marker = join(directory, "must-not-exist");
  const helper = new URL("env.sh", root).pathname;
  try {
    await writeFile(envPath, `POSTGRES_PASSWORD=$(touch ${marker})`);
    const result = spawnSync("/bin/sh", ["-c", `. "${helper}"; load_flowcontext_env "$1"`, "--", envPath], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    await assert.rejects(access(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict environment loader rejects a NUL byte before line parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowcontext-env-contract-"));
  const envPath = join(directory, ".env");
  const helper = new URL("env.sh", root).pathname;
  try {
    await writeFile(envPath, Buffer.from([
      "POSTGRES_PASSWORD=literal\0value",
      "FLOWCONTEXT_OWNER_ID=00000000-0000-4000-8000-000000000000",
      "FLOWCONTEXT_PUBLIC_URL=flowcontext.example.com",
    ].join("\n")));
    const result = spawnSync("/bin/sh", ["-c", `. "${helper}"; load_flowcontext_env "$1"`, "--", envPath], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
