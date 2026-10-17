import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.POSTGRES_URL) {
  throw new Error("POSTGRES_URL environment variable is not set");
}

function databaseClient() {
  try {
    const url = new URL(process.env.POSTGRES_URL!);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("Invalid database URL");
    return postgres(process.env.POSTGRES_URL!, {
      connect_timeout: 5,
      idle_timeout: 20,
      connection: { statement_timeout: 10000 },
    });
  } catch {
    throw new Error("Database configuration unavailable. Values withheld.");
  }
}
export const client = databaseClient();
export const db = drizzle(client, { schema });
