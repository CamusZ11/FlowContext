import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const app = buildServer({ config, repository: {} });

await app.listen({ host: "0.0.0.0", port: config.port });
