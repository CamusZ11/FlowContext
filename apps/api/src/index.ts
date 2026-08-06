import { createDatabasePool } from "./db.js";
import { PostgresAuthRepository } from "./enrollment.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const pool = createDatabasePool(config.databaseUrl);
const app = buildServer({ config, repository: new PostgresAuthRepository(pool) });

await app.listen({ host: "0.0.0.0", port: config.port });
