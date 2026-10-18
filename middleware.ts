import { NextResponse, type NextRequest } from "next/server";
import { signToken, verifyToken } from "@/lib/auth/session";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { siteGate, securityHeaders } from "@/lib/security/site-gate";
import { db } from "@/lib/db/drizzle";
import { users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function middleware(request: NextRequest) {
  const gate = siteGate(request.headers);
  const apply = (response: NextResponse) => {
    for (const [key, value] of Object.entries(securityHeaders()))
      response.headers.set(key, value);
    return response;
  };
  if (gate) {
    const html = request.headers.get("accept")?.includes("text/html");
    return apply(
      new NextResponse(
        html
          ? '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Private access · Mimi</title><body><main><h1>Private access required</h1><p>This environment is available only to authorized testers. Ask your trusted operator for access.</p></main></body></html>'
          : gate.status === 401
            ? "Private staging: tester authorization required."
            : "Service unavailable.",
        {
          status: gate.status,
          headers: {
            "Content-Type": html
              ? "text/html; charset=utf-8"
              : "text/plain; charset=utf-8",
            "Cache-Control": "private, no-store",
            ...(gate.challenge
              ? {
                  "WWW-Authenticate":
                    'Basic realm="Mimi private staging", charset="UTF-8"',
                }
              : {}),
          },
        },
      ),
    );
  }
  const pathname = request.nextUrl.pathname;
  const protectedRoute =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  const page =
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    !/\.[a-z0-9]+$/i.test(pathname);
  if (!page) return apply(NextResponse.next());
  const cookie = request.cookies.get("session");
  let session = null;
  if (cookie) {
    try {
      const parsed = await verifyToken(cookie.value);
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, parsed.user.id),
            eq(users.sessionVersion, parsed.version),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (user) session = parsed;
    } catch {
      /* Invalid or revoked sessions fail closed without logging tokens. */
    }
  }
  if (admin && (!session || !(await getStaffForUser(session.user.id))))
    return apply(
      new NextResponse(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied · Mimi</title><body><main><h1>Access denied</h1><p>Staff authorization is required for this space.</p><a href="/">Return to Mimi</a></main></body></html>',
        {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
          },
        },
      ),
    );
  let response =
    protectedRoute && !session
      ? NextResponse.redirect(new URL("/sign-in", request.url))
      : NextResponse.next();
  if (session && request.method === "GET") {
    const expires = new Date(Date.now() + 86400000);
    response.cookies.set(
      "session",
      await signToken({ ...session, expires: expires.toISOString() }),
      { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires },
    );
  } else if (cookie && !session) response.cookies.delete("session");
  return apply(response);
}
// Staging protects all paths. The two binary handlers enforce the same gate
// directly so Next does not buffer their streaming bodies before admission.
export const config = {
  matcher: ["/((?!api/(?:media|videos)/[^/]+/upload$).*)"],
  runtime: "nodejs",
};
