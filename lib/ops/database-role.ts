import "server-only";
import postgres from "postgres";
export const databaseRoleQuery = `select r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolbypassrls or has_database_privilege(current_user,current_database(),'CREATE') or has_table_privilege(current_user,'platform_staff','INSERT,UPDATE,DELETE') or has_table_privilege(current_user,'moderation_audit','UPDATE,DELETE') or exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relowner=r.oid) as unsafe from pg_roles r where r.rolname=current_user`;
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
