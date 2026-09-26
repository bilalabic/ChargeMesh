/**
 * Lazily created Drizzle client. Nothing connects until `getDb()` is first called,
 * so the server (health/config/chargers) and tests run without PostgreSQL.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  /** Returns the Drizzle instance, creating the connection pool on first use. */
  getDb(): Database;
  /** Closes the pool if it was created. */
  close(): Promise<void>;
}

export function createDbHandle(databaseUrl: string): DbHandle {
  let sqlClient: postgres.Sql | null = null;
  let db: Database | null = null;

  return {
    getDb() {
      if (!db) {
        sqlClient = postgres(databaseUrl, { max: 10, onnotice: () => {} });
        db = drizzle(sqlClient, { schema });
      }
      return db;
    },
    async close() {
      if (sqlClient) {
        await sqlClient.end({ timeout: 5 });
        sqlClient = null;
        db = null;
      }
    },
  };
}

export { schema };
