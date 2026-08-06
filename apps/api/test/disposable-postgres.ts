import { Pool, type PoolConfig } from "pg";

type PoolConstructor<T> = new (config: PoolConfig) => T;

const refusal = "refusing non-disposable DATABASE_URL; expected fixed localhost:55432/flowcontext_test with no options";

export function validatedDisposablePoolConfig(raw: string | undefined): PoolConfig {
  if (!raw) throw new Error("DATABASE_URL is required for the disposable PostgreSQL test");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(refusal);
  }
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.port !== "55432"
    || url.pathname !== "/flowcontext_test"
    || url.username !== "flowcontext_test"
    || url.password !== "flowcontext_test"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(refusal);
  }
  return {
    host: "127.0.0.1",
    port: 55432,
    database: "flowcontext_test",
    user: "flowcontext_test",
    password: "flowcontext_test",
    ssl: false,
  };
}

export function createDisposablePool<T = Pool>(
  raw: string | undefined,
  PoolClass: PoolConstructor<T> = Pool as unknown as PoolConstructor<T>,
): T {
  const config = validatedDisposablePoolConfig(raw);
  return new PoolClass(config);
}
