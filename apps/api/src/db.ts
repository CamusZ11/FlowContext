import { Pool, type PoolConfig } from "pg";

export function createDatabasePool(databaseUrl: string): Pool {
  const config: PoolConfig = { connectionString: databaseUrl };
  return new Pool(config);
}
