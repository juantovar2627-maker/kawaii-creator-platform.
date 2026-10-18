import { createHash, timingSafeEqual } from "node:crypto";
import {
  appMode,
  configurationIssues,
  loopback,
  type Environment,
} from "../config/runtime";
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function siteGate(
  headers: Headers,
  env: Environment = process.env,
): { status: number; challenge?: boolean } | null {
  if (configurationIssues(env).length) return { status: 503 };
  if (appMode(env) === "development") {
    try {
      if (!loopback(new URL("http://" + headers.get("host")).hostname))
        return { status: 403 };
    } catch {
      return { status: 403 };
    }
    return null;
  }
  const base = new URL(env.BASE_URL!);
  if (
    headers.get("host")?.toLowerCase() !== base.host ||
    headers.get("x-forwarded-proto") !== "https"
  )
    return { status: 403 };
  if (appMode(env) !== "staging") return null;
  const authorization = headers.get("authorization") || "";
  if (!/^Basic [a-zA-Z0-9+/=]{1,2048}$/.test(authorization))
    return { status: 401, challenge: true };
  const actual = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  if (
    !equalSecret(
      actual,
      `${env.STAGING_ACCESS_USERNAME}:${env.STAGING_ACCESS_PASSWORD}`,
    )
  )
    return { status: 401, challenge: true };
  return null;
}
export function securityHeaders(env: Environment = process.env) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    ...(appMode(env) !== "development"
      ? { "Strict-Transport-Security": "max-age=31536000" }
      : {}),
    ...(appMode(env) === "staging"
      ? {
          "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
          "Cache-Control": "private, no-store",
        }
      : {}),
  };
}
