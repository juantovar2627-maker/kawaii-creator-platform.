import "server-only";
import postgres from "postgres";
import { databaseRoleQuery } from "./database-role-query.mjs";
export { databaseRoleQuery };
export async function assertApplicationDatabaseRole() {
  const sql = postgres(process.env.POSTGRES_URL!, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 1,
    connection: { statement_timeout: 3000 },
    onnotice: () => {},
  });
  try {
    const [role] = await sql.unsafe(databaseRoleQuery);
    if (!role || role.unsafe) throw new Error("Unsafe role");
  } catch {
    throw new Error(
      "Application database security verification failed. Use verified TLS and a restricted application role; details withheld.",
    );
  } finally {
    await sql.end();
  }
}
