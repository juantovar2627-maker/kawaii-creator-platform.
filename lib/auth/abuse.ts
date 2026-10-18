import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { authRateLimits as limits } from "@/lib/db/schema";
import { appMode, trustedOrigin } from "@/lib/config/runtime";
export async function actionOriginAllowed() {
  const h = await headers();
  return trustedOrigin(h.get("origin"), h.get("host"));
}
export async function consumeAuthLimit(
  scope: string,
  subject: string,
  max: number,
  seconds: number,
) {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error("Authentication configuration unavailable.");
  const subjectHash = createHmac("sha256", key)
    .update(scope + ":" + subject)
    .digest("hex");
  const expired = sql`${limits.startedAt} <= now() - ${seconds} * interval '1 second'`;
  const [row] = await db
    .insert(limits)
    .values({ scope, subjectHash })
    .onConflictDoUpdate({
      target: [limits.scope, limits.subjectHash],
      set: {
        attempts: sql`case when ${expired} then 1 else least(${limits.attempts}+1,1000000) end`,
        startedAt: sql`case when ${expired} then now() else ${limits.startedAt} end`,
      },
    })
    .returning({ attempts: limits.attempts });
  return row.attempts <= max;
}
export async function authenticationAttempt(
  kind: "signin" | "signup",
  form: FormData,
) {
  if (!(await actionOriginAllowed())) return false;
  const h = await headers(),
    header = process.env.TRUSTED_CLIENT_IP_HEADER;
  // Only a trusted, stripping ingress may set this header. Never trust arbitrary XFF.
  const ip = header ? h.get(header) : null;
  if ((header && !isIP(ip || "")) || (!header && appMode() !== "development"))
    return false;
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase()
    .slice(0, 255);
  if (
    ip &&
    !(await consumeAuthLimit(
      kind + "_client",
      ip,
      kind === "signin" ? 50 : 5,
      kind === "signin" ? 900 : 3600,
    ))
  )
    return false;
  if (
    !(await consumeAuthLimit(
      kind + "_email",
      email,
      kind === "signin" ? 10 : 5,
      kind === "signin" ? 900 : 3600,
    ))
  )
    return false;
  return true;
}
