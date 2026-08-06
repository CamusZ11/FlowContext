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
