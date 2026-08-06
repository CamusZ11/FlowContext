# FlowContext 自托管免登录迁移 Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** 将 FlowContext 迁移到自有服务器上的 PostgreSQL 与 HTTPS API，使已登记的 Mac/Windows 设备无需账号密码即可安全使用。
**Architecture:** 新增 Node 22/Fastify API，使用参数化 PostgreSQL 查询、每设备哈希令牌和 SSE 代替 Supabase Auth、Data API、Realtime 与 Edge Function。桌面端将设备令牌保存在已有 Tauri 受保护存储中，首次登记后静默取得固定单人 session；服务器用 Docker Compose 与 Caddy 部署，导入前后进行可复现的数据核验。
**Tech Stack:** Node 22、TypeScript、Fastify、node-postgres、Vitest、PostgreSQL 16、Docker Compose、Caddy、React 19、Tauri 2。
## Global Constraints
- 生产客户端固定使用 `VITE_FLOWCONTEXT_PROVIDER=self-hosted`；不得包含 Supabase URL、anon key、服务角色密钥、设备令牌或登记码。
- 数据库只能被 API 容器访问；不映射 5432 到宿主机或公网。
- 日常界面不能出现账号、邮箱、密码、注册、登录或退出；只有无凭据/已吊销设备显示一次性登记页。
- `device_token` 和登记码只传输一次；数据库与日志只保留 SHA-256 哈希，日志不得记录 `Authorization`、Cookie、请求体或连接字符串。
- Topic、Session、Handoff 与 To-do 的既有领域语义不变：只有明确完成才可将 Topic 标为 done；Handoff 与 Topic 连续性在同一事务内写入。
- 实现严格按测试先行：每项生产行为先写失败测试并确认失败，再写最小实现并确认通过。
- 不改变 macOS 原生浮窗、Deep Link、Obsidian 项目语义、本地业务数据库边界或离线写入边界。
---
## 文件结构
|路径|职责|
|---|---|
|`apps/api/`|独立的 Fastify HTTP API、配置、认证、PostgreSQL 仓储、SSE 与 Vitest 测试|
|`apps/api/migrations/`|自托管 PostgreSQL schema、约束、函数与版本表|
|`apps/api/src/auth.ts`|Bearer 令牌和一次性登记码哈希、验证、吊销语义|
|`apps/api/src/repository.ts`|所有业务读写的 owner-scoped 参数化 SQL 与事务|
|`apps/api/src/router.ts`|完整 REST/SSE 契约、输入校验和稳定错误码|
|`apps/web/src/features/auth/`|免登录 session 和一次性设备登记体验|
|`packages/data/src/HttpFlowRepository.ts`|自托管 To-do 滚动能力与完整 HTTP 契约映射|
|`tools/self-hosted-migration/`|只读 Supabase 导出、新库导入和两端一致性核验 CLI|
|`deploy/flowcontext/`|Caddy、Compose、受限环境变量模板、服务器部署/恢复操作|
## Task 1: 建立可测试的自托管 API 与数据库迁移基础
**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/migrate.ts`
- Create: `apps/api/migrations/001_core.sql`
- Create: `apps/api/test/config.test.ts`
- Create: `apps/api/test/health.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
**Interfaces:**
- Produces `loadConfig(env): ApiConfig`, where `ApiConfig` contains `port`, `databaseUrl`, `ownerId`, and `logLevel`.
- Produces `buildServer(deps): FastifyInstance` with unauthenticated `GET /healthz -> { status: "ok" }`.
- Produces `runMigrations(pool, directory): Promise<string[]>`, which records applied filenames in `schema_migrations`.
**Step 1: Write the failing config and health tests.**
```ts
it("rejects a missing database URL without exposing environment values", () => {
  expect(() => loadConfig({ PORT: "8080" })).toThrow("DATABASE_URL is required");
});
it("serves an unauthenticated health response", async () => {
  const app = buildServer({ repository: fakeRepository(), config: testConfig() });
  expect((await app.inject("/healthz")).json()).toEqual({ status: "ok" });
});
```
**Step 2: Verify RED.**
Run: `pnpm --filter @flowcontext/api test -- config.test.ts health.test.ts`
Expected: FAIL because the API package and exported functions do not exist.
**Step 3: Add the smallest package, configuration parser and health server.**
```ts
export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return { port: Number(env.PORT ?? 8080), databaseUrl, ownerId: env.FLOWCONTEXT_OWNER_ID!, logLevel: env.LOG_LEVEL ?? "info" };
}
```
Use Node 22, Fastify and `pg` with exact versions recorded by `pnpm add --filter @flowcontext/api`; add `pnpm api:test`, `pnpm api:typecheck`, and `pnpm api:migrate` scripts without changing existing commands.
**Step 4: Add the initial self-hosted schema migration.**
Create the singleton `owners` table and the existing business tables with UUID primary keys, owner-scoped foreign keys, Handoff idempotency uniqueness, To-do indexes and required check constraints. Replace every `auth.users` reference with `owners`; omit RLS, realtime publication and Supabase-only functions.
**Step 5: Verify GREEN.**
Run: `pnpm install --frozen-lockfile=false && pnpm --filter @flowcontext/api typecheck && pnpm --filter @flowcontext/api test`
Expected: PASS; tests prove config errors are body-free and health does not require credentials.
**Step 6: Commit.**
```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/api
git commit -m "feat(api): add self-hosted service foundation"
```
## Task 2: Implement device enrollment, protected session and revocation
**Files:**
- Create: `apps/api/src/auth.ts`
- Create: `apps/api/src/enrollment.ts`
- Create: `apps/api/src/errors.ts`
- Create: `apps/api/test/auth.test.ts`
- Create: `apps/api/test/enrollment.test.ts`
- Create: `apps/api/migrations/002_api_constraints.sql`
- Modify: `apps/api/src/server.ts`
**Interfaces:**
- Produces `hashSecret(value: string): string` using `crypto.createHash("sha256")`.
- Produces `authenticate(request): Promise<Principal>`; `Principal` is `{ ownerId: string; deviceId: string }`.
- Produces `POST /v1/devices/enroll` accepting `{ enrollmentCode, deviceId, platform }` and returning `{ deviceToken, userId }` exactly once.
- Produces `GET /v1/auth/session` returning `{ userId }`; invalid/revoked device returns `{ error: "device_unauthorized" }` with 401.
**Step 1: Write failing behavior tests.**
```ts
it("returns a token once when a valid unused code enrolls a device", async () => {
  const response = await app.inject({ method: "POST", url: "/v1/devices/enroll", payload: validEnrollment });
  expect(response.statusCode).toBe(201);
  expect(response.json().deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await repository.findEnrollment(hashSecret(validEnrollment.enrollmentCode))).toMatchObject({ consumedAt: expect.any(String) });
});
it("rejects a revoked device without calling a business route", async () => {
  const response = await app.inject({ url: "/v1/auth/session", headers: { authorization: "Bearer revoked" } });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "device_unauthorized" });
});
```
**Step 2: Verify RED.**
Run: `pnpm --filter @flowcontext/api test -- auth.test.ts enrollment.test.ts`
Expected: FAIL because enrollment routes and `hashSecret` are absent.
**Step 3: Add enrollment schema and server-only management operations.**
Add `device_enrollments(code_hash, expires_at, consumed_at, device_id)` and `device_tokens(token_hash, owner_id, device_id, revoked_at)` with unique hashes. Add CLI subcommands `enrollment create --ttl-minutes 15` and `device revoke --device-id <uuid>`; both print only identifiers/expiry, never raw stored hashes or tokens. Generate a 32-byte base64url device token with `crypto.randomBytes(32)`.
**Step 4: Add authentication hook and public routes.**
Use the Fastify pre-handler for all `/v1/*` routes except enrollment and health. Parse only `Bearer <token>`, hash it, query non-revoked token, and attach `request.principal`. Consume a matching unexpired enrollment code and create its device token in one transaction.
**Step 5: Verify GREEN and no-secret logging.**
Run: `pnpm --filter @flowcontext/api test -- auth.test.ts enrollment.test.ts && pnpm --filter @flowcontext/api typecheck`
Expected: PASS; captured logger output contains neither `Bearer` nor supplied code/token.
**Step 6: Commit.**
```bash
git add apps/api
git commit -m "feat(api): add one-time device enrollment"
```
## Task 3: Port owner-scoped data access and complete the REST/SSE API
**Files:**
- Create: `apps/api/src/repository.ts`
- Create: `apps/api/src/router.ts`
- Create: `apps/api/src/sse.ts`
- Create: `apps/api/test/repository.integration.test.ts`
- Create: `apps/api/test/router.test.ts`
- Create: `apps/api/test/sse.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/migrations/001_core.sql`
**Interfaces:**
- Produces `PostgresFlowRepository` methods matching `FlowRepository`: To-do CRUD/rollover, suggested topics, Topic Context and Daily Projection reads.
- Produces routes `GET/POST /v1/todos`, `PATCH/DELETE /v1/todos/:id`, `POST /v1/todos/rollover`, `GET /v1/todos/stream`, `GET /v1/topics`, `GET /v1/topics/:id/context`, `GET /v1/daily-projections/:date`, and existing Project/Topic/Session/Handoff writes.
- Produces all API fields in camelCase and errors `{ error: string }`; unknown owner-scoped resources return 404.
**Step 1: Write failing database integration tests against a disposable PostgreSQL database.**
```ts
it("rolls yesterday's incomplete todos forward atomically for the authenticated device timezone", async () => {
  await seedTodo({ plannedDate: "2026-08-05", isCompleted: false });
  await seedTodo({ plannedDate: "2026-08-05", isCompleted: true });
  const result = await repository.rolloverIncompleteTodos(principal, "2026-08-05", "2026-08-06", "Asia/Shanghai");
  expect(result).toHaveLength(1);
  expect(await todosFor("2026-08-05")).toHaveLength(1);
});
it("returns 404 rather than 422 when PATCH targets an unknown todo", async () => {
  const response = await authenticatedInject({ method: "PATCH", url: "/v1/todos/missing", payload: { title: "x" } });
  expect(response.statusCode).toBe(404);
});
```
**Step 2: Verify RED.**
Run: `DATABASE_URL=postgresql://flowcontext_test:flowcontext_test@127.0.0.1:55432/flowcontext_test pnpm --filter @flowcontext/api test -- repository.integration.test.ts router.test.ts sse.test.ts`
Expected: FAIL because no repository or routes exist. Start the disposable database only with `docker compose -f apps/api/test/docker-compose.yml up -d`.
**Step 3: Implement parameterized repository queries and transactions.**
Every query includes `owner_id = $n`; never interpolate user input. Use `BEGIN/COMMIT/ROLLBACK` for enrollment consumption, Handoff+Topic update and To-do rollover. Add `002_api_constraints.sql` for API-specific constraints/functions/notifications; never modify an applied `001_core.sql`. Route validations must check ISO dates, IANA timezone identifiers, UUIDs, pagination bounds and JSON body types before querying.
**Step 4: Implement SSE with notification and recovery semantics.**
After a committed To-do create/update/delete/rollover, publish the owner/date event through PostgreSQL `NOTIFY`. `GET /v1/todos/stream?date=YYYY-MM-DD` authenticates first, writes valid `text/event-stream` frames, sends periodic comments, and closes listeners on disconnect. A reconnecting client always refetches `GET /v1/todos` before accepting later events.
**Step 5: Verify GREEN.**
Run: `pnpm --filter @flowcontext/api test && pnpm --filter @flowcontext/api typecheck`
Expected: PASS; includes transaction rollback, 401/404/409/422 mapping, Handoff atomicity, SSE event framing and owner isolation.
**Step 6: Commit.**
```bash
git add apps/api
git commit -m "feat(api): implement self-hosted FlowContext routes"
```
## Task 4: Make the HTTP data provider feature-complete
**Files:**
- Modify: `packages/data/src/HttpFlowRepository.ts`
- Modify: `packages/data/src/HttpFlowRepository.test.ts`
- Modify: `packages/data/src/httpTransport.ts`
**Interfaces:**
- Changes `HttpFlowRepository.capabilities` to `{ todoRollover: true }`.
- Maps `rolloverIncompleteTodos(fromDate, toDate)` to `POST /v1/todos/rollover` with `{ fromDate, toDate, timezone }`.
- Continues mapping all fields to the existing `FlowRepository` types with body-free `HttpError` errors.
**Step 1: Write the failing rollover and error tests.**
```ts
it("posts the two dates and timezone to the atomic rollover endpoint", async () => {
  await repository.rolloverIncompleteTodos("2026-08-05", "2026-08-06");
  expect(fetchImpl).toHaveBeenCalledWith("https://api.example/v1/todos/rollover", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ fromDate: "2026-08-05", toDate: "2026-08-06" });
});
```
**Step 2: Verify RED.**
Run: `pnpm --filter @flowcontext/data test -- HttpFlowRepository.test.ts`
Expected: FAIL because the provider currently throws `not supported`.
**Step 3: Implement the one-request rollover mapping.**
Extend options with `getTimezone: () => string`; pass `Intl.DateTimeFormat().resolvedOptions().timeZone` from bootstrap. Require a non-empty IANA string client-side, use one POST, and map its returned To-dos with existing `mapTodo`.
**Step 4: Verify GREEN.**
Run: `pnpm --filter @flowcontext/data test && pnpm --filter @flowcontext/data typecheck`
Expected: PASS; existing read, write, topic context, Daily Projection and SSE tests remain green.
**Step 5: Commit.**
```bash
git add packages/data
git commit -m "feat(data): support self-hosted todo rollover"
```
## Task 5: Replace password login with one-time device registration
**Files:**
- Create: `apps/web/src/features/auth/DeviceEnrollmentForm.tsx`
- Create: `apps/web/src/features/auth/DeviceEnrollmentForm.test.tsx`
- Modify: `apps/web/src/features/auth/useAuth.ts`
- Modify: `apps/web/src/features/auth/httpAuth.test.ts`
- Modify: `apps/web/src/features/auth/AuthGate.tsx`
- Modify: `apps/web/src/features/auth/AuthGate.test.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/platform/PlatformPort.ts`
- Modify: `apps/web/src/platform/tauriPlatform.ts`
- Modify: `apps/web/src/platform/tauriPlatform.test.ts`
**Interfaces:**
- Produces `PasswordlessAuthPort` with `getSession()`, `onAuthStateChange(listener)`, `enroll(input)` and `clearDeviceCredential()`; it has no `signIn` or `signOut` method.
- Produces `DeviceEnrollmentForm` accepting `{ apiUrl, enrollmentCode }` and storing a returned `deviceToken` only through `platform.sessionStorage`.
- Uses secure storage keys `device-id` and `flowcontext.device-token`; no token reaches browser localStorage.
**Step 1: Write failing desktop and UI tests.**
```tsx
it("opens the app directly when an enrolled device token has a valid session", async () => {
  render(<AuthGate auth={validDeviceAuth}>{() => <p>主界面</p>}</AuthGate>);
  expect(await screen.findByText("主界面")).toBeInTheDocument();
  expect(screen.queryByLabelText(/密码|邮箱|登录/)).not.toBeInTheDocument();
});
it("stores an enrollment token in native session storage and not browser localStorage", async () => {
  await auth.enroll({ apiUrl: "https://api.example", enrollmentCode: "single-use" });
  expect(await platform.sessionStorage.get("flowcontext.device-token")).toBe("issued-token");
});
```
**Step 2: Verify RED.**
Run: `pnpm --filter @flowcontext/web test -- AuthGate.test.tsx httpAuth.test.ts DeviceEnrollmentForm.test.tsx tauriPlatform.test.ts`
Expected: FAIL because `enroll` and the device-registration UI are absent and `LoginForm` is still rendered.
**Step 3: Implement passwordless API client and UI.**
Make `GET /v1/auth/session` silent when a token exists. On 401, atomically remove only the device token and notify null. `POST /v1/devices/enroll` sends the code only for that request, writes returned token to secure storage, then confirms session. `AuthGate` presents neutral device-registration copy on no credential/network error; delete `LoginForm` and its imports/tests after all callers are migrated.
**Step 4: Fix provider bootstrap and storage boundaries.**
Pass `getAccessToken` from `flowcontext.device-token`; preserve `device-id` generation. Keep macOS Keychain/process-memory fallback and verify that the fallback never becomes WebView localStorage. For browser development, scope the temporary credential to `sessionStorage` and label it non-production.
**Step 5: Verify GREEN.**
Run: `pnpm --filter @flowcontext/web test && pnpm --filter @flowcontext/web typecheck && pnpm --filter @flowcontext/web build`
Expected: PASS; production bundle search finds no `supabase.co`, `signInWithPassword`, `LoginForm`, `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`.
**Step 6: Commit.**
```bash
git add apps/web packages/data
git commit -m "feat(web): enroll devices without password login"
```
## Task 6: Remove Supabase production dependencies and add migration tooling
**Files:**
- Create: `tools/self-hosted-migration/package.json`
- Create: `tools/self-hosted-migration/src/export.ts`
- Create: `tools/self-hosted-migration/src/import.ts`
- Create: `tools/self-hosted-migration/src/verify.ts`
- Create: `tools/self-hosted-migration/src/index.ts`
- Create: `tools/self-hosted-migration/src/verify.test.ts`
- Modify: `apps/web/package.json`
- Modify: `packages/data/package.json`
- Modify: `apps/web/src/main.tsx`
- Modify: `.gitignore`
- Modify: `README.md`
**Interfaces:**
- Produces `flowcontext-migrate export --output <directory>`, `import --input <directory>` and `verify --input <directory>`.
- Export file set is newline-delimited JSON for exactly the seven business tables and a `manifest.json` containing per-table row count plus SHA-256 file digest; it excludes tokens and Supabase Auth rows.
- `verify` returns nonzero when rows, foreign-key references, newest Handoff by Topic, selected To-do rows, Daily Projection sample or manifest digest diverge.
**Step 1: Write failing fixture-based migration verification tests.**
```ts
it("rejects an import whose handoff count matches but newest topic handoff differs", async () => {
  await seedTargetWithWrongLatestHandoff();
  await expect(verifyImport(fixtureDirectory, targetPool)).rejects.toThrow("latest_handoff_mismatch");
});
```
**Step 2: Verify RED.**
Run: `pnpm --filter @flowcontext/self-hosted-migration test -- verify.test.ts`
Expected: FAIL because the migration package and verifier do not exist.
**Step 3: Implement read-only export and transactional import.**
Read source credentials only from a user-provided, untracked local environment file. Export one table at a time with a consistent source snapshot, write mode `0600`, and redact connection values in errors. Import in foreign-key order inside transactions; refuse nonempty target tables unless `--replace-empty-target` was explicitly given and verified to point to the disposable target database.
**Step 4: Implement consistency verifier and remove production Supabase code.**
Compare manifest digests/counts, FK queries, latest Handoff and named sample rows. Remove `@supabase/supabase-js`, `SupabaseFlowRepository`, `supabaseClientFactory`, Supabase build env variables and production dependency paths only after self-hosted tests pass; retain historical `supabase/` migrations/tests until data migration is completed and the user explicitly authorizes archival.
**Step 5: Verify GREEN.**
Run: `pnpm --filter @flowcontext/self-hosted-migration test && pnpm verify && rg -n -i 'supabase\.co|VITE_SUPABASE|signInWithPassword' apps packages --glob '!**/node_modules/**'`
Expected: all tests PASS; final search prints no production matches.
**Step 6: Commit.**
```bash
git add tools/self-hosted-migration apps/web packages/data package.json pnpm-lock.yaml .gitignore README.md
git commit -m "feat: migrate FlowContext off Supabase"
```
## Task 7: Add reproducible hardened server deployment assets
**Files:**
- Create: `deploy/flowcontext/docker-compose.yml`
- Create: `deploy/flowcontext/Caddyfile`
- Create: `deploy/flowcontext/.env.example`
- Create: `deploy/flowcontext/scripts/preflight.sh`
- Create: `deploy/flowcontext/scripts/deploy.sh`
- Create: `deploy/flowcontext/scripts/create-enrollment.sh`
- Create: `deploy/flowcontext/scripts/revoke-device.sh`
- Create: `deploy/flowcontext/README.md`
- Create: `deploy/flowcontext/test/compose-contract.test.mjs`
**Interfaces:**
- Produces three services `postgres`, `api`, `caddy`; only Caddy publishes `80:80` and `443:443`.
- Produces `preflight.sh` that fails unless Docker Compose, an SSH-key-based non-root deploy account, writable data directory and valid DNS/TLS configuration are present.
- Produces `create-enrollment.sh <device-id>` and `revoke-device.sh <device-id>` that execute inside the private API container without echoing secrets.
**Step 1: Write failing Compose contract tests.**
```js
test("postgres has no published ports and API is not publicly published", () => {
  const compose = readYaml("deploy/flowcontext/docker-compose.yml");
  assert.deepEqual(compose.services.postgres.ports ?? [], []);
  assert.deepEqual(compose.services.api.ports ?? [], []);
  assert.deepEqual(compose.services.caddy.ports, ["80:80", "443:443"]);
});
```
**Step 2: Verify RED.**
Run: `node --test deploy/flowcontext/test/compose-contract.test.mjs`
Expected: FAIL because deployment assets do not exist.
**Step 3: Add Compose, Caddy and environment contracts.**
Use private named networks, persistent PostgreSQL volume, health checks, restart policies and read-only Caddy config. `.env.example` contains variable names only: `POSTGRES_PASSWORD`, `FLOWCONTEXT_OWNER_ID`, `FLOWCONTEXT_PUBLIC_URL`, `ACME_EMAIL`; production `.env` stays server-only mode `0600` and is ignored by Git. Caddy redirects HTTP to HTTPS and proxies only `/` to API.
**Step 4: Add safe operational scripts.**
`preflight.sh` emits versions, open listener summary and DNS/TLS checks without secrets. `deploy.sh` uses `docker compose config`, runs migrations, waits for `/healthz`, then prints only the public URL. Enrollment/revocation scripts validate UUIDs before invoking the API CLI; never accept codes/tokens as command arguments.
**Step 5: Verify GREEN.**
Run: `node --test deploy/flowcontext/test/compose-contract.test.mjs && docker compose -f deploy/flowcontext/docker-compose.yml config`
Expected: PASS; configuration exposes only 80/443 and contains no committed secret values.
**Step 6: Commit.**
```bash
git add deploy/flowcontext
git commit -m "feat(deploy): add private FlowContext server stack"
```
## Task 8: Provision server, migrate data and perform controlled cutover
**Files:**
- Create: `docs/self-hosted-cutover-runbook.md`
- Modify: `README.md`
- Modify: `/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext/status.md`
**Interfaces:**
- Produces an auditable runbook with checkboxes for backups, source freeze, export/import/verify, server deployment, per-device registration, rollback and evidence capture.
- Produces no code path that reads or writes a root password, database password, token or enrollment code into the repository, shell history or project Context.
**Step 1: Write a failing preflight checklist test.**
```js
test("cutover runbook requires backup hash, export manifest, target verification and two device checks before source shutdown", () => {
  const text = readFileSync("docs/self-hosted-cutover-runbook.md", "utf8");
  for (const item of ["backup SHA-256", "manifest.json", "verify --input", "macOS", "Windows", "rollback"]) assert.match(text, new RegExp(item));
});
```
**Step 2: Verify RED.**
Run: `node --test deploy/flowcontext/test/cutover-runbook.test.mjs`
Expected: FAIL because the cutover runbook is absent.
**Step 3: Perform server preflight before any destructive change.**
Use an interactive credential channel only; inspect OS, architecture, disk, memory, firewall, existing services, Docker, DNS ownership and listening ports. Create and validate a non-root SSH-key deploy account before disabling root password login. Do not change SSH configuration until the key-based account has successfully opened a second independent session.
**Step 4: Deploy a clean server stack and verify external boundary.**
Run `preflight.sh`, transfer only deployment artifacts, create server-only `.env`, start Compose and apply migrations. Verify HTTPS certificate, `/healthz`, 80→443 redirect, no public `5432`/API port, container health, restart persistence and log redaction.
**Step 5: Export, import and verify data before cutover.**
Freeze Supabase application writes, produce mode-0600 export directory and SHA-256 backup, import into the empty target, then run verifier. Stop on any mismatch; rollback by keeping desktop clients pointed at Supabase and deleting only the newly-created disposable target database after target confirmation.
**Step 6: Register and test both desktop devices.**
Generate a separate one-time code per device, enroll Mac then Windows, delete each displayed code from the local input after success, and restart each application. On both devices test To-do CRUD/rollover, Topic Context, Handoff, SSE propagation, original Codex thread deep link and native overlay regression.
**Step 7: Switch and document verified state.**
Build production clients with the self-hosted API URL only, verify no Supabase endpoints or keys in artifacts, and install them. Retain the old Supabase project as read-only rollback for the agreed window. Update `status.md` only with verified evidence, server public URL (if the user wants it recorded), migration manifest digest, test results, active device count and rollback endpoint; never write credentials.
**Step 8: Verify completion and commit documentation.**
Run: `pnpm verify && pnpm --filter @flowcontext/api test && node --test deploy/flowcontext/test/*.test.mjs && rg -n -i 'supabase\.co|VITE_SUPABASE|signInWithPassword' apps packages deploy --glob '!**/node_modules/**'`
Expected: all tests PASS; search has no production match; server boundary and two-device manual checks are recorded in the runbook.
```bash
git add docs/self-hosted-cutover-runbook.md README.md
git commit -m "docs: record self-hosted FlowContext cutover"
```
## Plan self-review
|规格要求|对应任务|
|---|---|
|PostgreSQL、API、Caddy 与私有数据库网络|1、3、7、8|
|一次性设备登记、静默免登录、吊销|2、5、8|
|完整 HTTP/SSE/To-do 滚动契约|3、4|
|数据导出、导入和校验|6、8|
|移除 Supabase、登录页与敏感构建配置|5、6、8|
|日志、TLS、非 root 运维与秘密边界|2、7、8|
|两端桌面及既有产品行为验收|5、8|
