# Task 7 report — hardened self-hosted deployment assets
## Implemented
- Added `deploy/flowcontext/docker-compose.yml`: private `postgres`, `api`, and `caddy` stack on the internal `flowcontext_internal` network. Only Caddy publishes TCP 80/443; PostgreSQL persists in `postgres_data` and neither PostgreSQL nor API has a host port.
- Added API image build recipe, read-only Caddyfile mount, health checks, restart policies, and API migration-before-start command.
- Added names-only `.env.example` plus local `.env` ignore. Caddy receives only the two values it needs, not the database password or owner ID.
- Added non-root SSH/Docker/data-path/DNS preflight and UUID-validating private-container enrollment/revocation scripts.
- Added an operator README requiring a real domain/DNS for Caddy HTTPS and `chmod 0600 .env`; it explicitly rejects bare-IP and self-signed TLS.
## TDD evidence
- RED: `node --test deploy/flowcontext/test/compose-contract.test.mjs` initially failed because the deployment assets did not exist.
- GREEN: the same contract suite passes 4/4, covering public-port boundary, private internal network, restart/health/migration contract, no embedded secrets, names-only env contract, Caddy proxy/HTTPS config, script UUID validation, and operator requirements.
## Verification
- `node --test deploy/flowcontext/test/compose-contract.test.mjs` — pass (4/4).
- `POSTGRES_PASSWORD=<non-secret contract value> FLOWCONTEXT_OWNER_ID=<contract UUID> FLOWCONTEXT_PUBLIC_URL=<contract hostname> ACME_EMAIL=<contract email> docker compose -f deploy/flowcontext/docker-compose.yml config` — pass.
- `docker run ... caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` — pass using contract-only hostname/email.
- `sh -n deploy/flowcontext/{preflight,deploy,create-enrollment,revoke-device}.sh` — pass.
- Invalid UUID calls for both device scripts return usage exit status 2 before invoking Docker.
- `pnpm verify` — pass: all workspace typechecks and tests; API 43 passed / 5 opt-in PostgreSQL tests skipped, Web 75 passed.
- `git diff --check` — pass.
## Scope and safety
- No server connection, real `.env`, credentials, data export/import, or application runtime behavior was changed.
- An API image build was started with contract-only values but the local Docker daemon could not finish pulling `node:22-alpine` during this session; this is an environment/network limitation, not a failed build command. The Compose model and Caddy config were validated independently.
## Review remediation
- Split networking into `flowcontext_edge` and the internal-only `flowcontext_internal`: Caddy joins both so it can obtain ACME certificates, while API and PostgreSQL join only the internal network.
- `preflight.sh` now requires `.env` mode 0600, validates Compose without printing values, emits only a non-sensitive 80/443 listener summary, and checks the DNS/TLS hostname precondition. `deploy.sh` repeats Compose validation, uses `up -d --build --wait --wait-timeout 120`, verifies public HTTPS `/healthz`, and prints the URL only after all checks succeed.
- Added forward-only `005_prebound_device_enrollments.sql` without changing migrations 001–004. Admin enrollment creation now requires a UUID device ID, stores that binding with the hash, and enrollment atomically refuses a different device ID. The deploy wrapper passes its required device ID to that server-only command.
- Added contract coverage for edge/internal boundaries and deployment failure gates, API tests for pre-bound enrollment, malformed/missing IDs, and duplicate CLI flags.
## Remediation verification
- Contract suite: 4/4 passing.
- API admin/enrollment suite: 46 tests passing (with five opt-in PostgreSQL tests skipped in the normal suite).
- Disposable PostgreSQL: 5/5 passing with migrations 001–005 applied, then container and network removed.
- Full `pnpm verify`: passing.
## Second review remediation
- `deploy.sh` now independently requires and mode-checks `.env`, loads it in its own shell, and requires `FLOWCONTEXT_PUBLIC_URL` before Compose validation, wait, HTTPS health validation, or a success URL. No value is printed before the final success line.
- `preflight.sh` now requires `ss` and fails closed when any process listens on TCP 80 or 443; it only reports a free-port summary when both are available. This deliberately does not attempt a permissive Caddy-container exception, preventing an unrelated listener from being replaced.
- Contract coverage was expanded for both independent deploy loading and the closed port-conflict gate.
## Second remediation verification
- `node --test deploy/flowcontext/test/compose-contract.test.mjs` — pass (4/4).
- Shell syntax checks and Compose config using contract-only values — pass.
- Disposable PostgreSQL `test:postgres` — pass (5/5), then test container/network removed.
- `pnpm verify` — pass.
