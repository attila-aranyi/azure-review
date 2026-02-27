import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type DrizzleInstance = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: DrizzleInstance | null = null;

export function getDb(): DrizzleInstance {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDb() first.");
  }
  return db;
}

export async function initializeDb(databaseUrl: string): Promise<void> {
  if (pool) {
    return;
  }
  // MED-11: Create pool but don't assign to module var until connection is verified
  const newPool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify the connection works before assigning
  const client = await newPool.connect();
  client.release();

  // Only assign after successful verification
  pool = newPool;
  db = drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export function createDb(poolInstance: pg.Pool): DrizzleInstance {
  return drizzle(poolInstance, { schema });
}
