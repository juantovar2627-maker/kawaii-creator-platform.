import { NextRequest } from "next/server";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { privateJson, safely, HttpError } from "@/lib/moderation/http";
import { equalSecret } from "@/lib/security/site-gate";
import { diagnostics } from "@/lib/ops/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  return safely(async () => {
    const token = request.headers.get("x-mimi-health-token") || "",
      configured = process.env.HEALTHCHECK_TOKEN;
    const infrastructure =
      !!configured && token.length <= 512 && equalSecret(token, configured);
    if (!infrastructure) {
      const user = await getUser();
      if (!user || !(await getStaffForUser(user.id)))
        throw new HttpError(403, "Staff authorization required.");
    }
    const result = await diagnostics();
    return privateJson(result, result.ready ? 200 : 503);
  });
}
