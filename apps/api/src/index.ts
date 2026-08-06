import { createDatabasePool } from "./db.js";
import { loadConfig } from "./config.js";
import { PostgresFlowRepository } from "./repository.js";
import { buildServer } from "./server.js";
import { PostgresTodoEventSource } from "./sse.js";

const config = loadConfig(process.env);
const pool = createDatabasePool(config.databaseUrl);
const app = buildServer({
  config,
  repository: new PostgresFlowRepository(pool),
  todoEvents: new PostgresTodoEventSource(pool),
});

await app.listen({ host: "0.0.0.0", port: config.port });
