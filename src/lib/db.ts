import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.DATABASE_URL.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => console.error("[db] havuz hatası:", err.message));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query(`set local search_path to ${config.DB_SCHEMA}, public`);
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

export async function healthcheck(): Promise<boolean> {
  try {
    const r = await pool.query("select 1 as ok");
    return r.rows.length === 1;
  } catch {
    return false;
  }
}
