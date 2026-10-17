/** Server-only settings. Pure validation also supports tests without real services. */
export type Environment = Record<string, string | undefined>;
export type AppMode = "development" | "staging" | "production";
export const loopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
export function appMode(env: Environment = process.env): AppMode {
  if (env.APP_ENV === "staging" || env.APP_ENV === "production")
    return env.APP_ENV;
  return "development";
}
export const uploadsEnabled = (env: Environment = process.env) =>
  env.MEDIA_UPLOADS_ENABLED === "true" ||
  (appMode(env) === "development" && env.MEDIA_UPLOADS_ENABLED !== "false");
export const videosEnabled = (env: Environment = process.env) =>
  uploadsEnabled(env) &&
  (env.VIDEO_UPLOADS_ENABLED === "true" ||
    (appMode(env) === "development" && env.VIDEO_UPLOADS_ENABLED !== "false"));
export const signupEnabled = (env: Environment = process.env) =>
  env.SIGNUP_ENABLED === "true" ||
  (appMode(env) === "development" && env.SIGNUP_ENABLED !== "false");
export const strongSecret = (value: string | undefined) =>
  !!value &&
  value.length >= 32 &&
  value.length <= 512 &&
  new Set(value).size >= 8 &&
  !/^(?:change|example|placeholder|test|your[-_])/i.test(value);
const https = (value: string | undefined) => {
  try {
    const u = new URL(value || "");
    return u.protocol === "https:" && !u.username && !u.password && !u.hash;
  } catch {
    return false;
  }
};
export function trustedOrigin(
  origin: string | null,
  host: string | null,
  env: Environment = process.env,
) {
  try {
    const u = new URL(origin || "");
    if (u.origin !== origin || u.host !== host?.toLowerCase()) return false;
    if (appMode(env) === "development")
      return ["http:", "https:"].includes(u.protocol) && loopback(u.hostname);
    return (
      u.protocol === "https:" &&
      u.origin === new URL(env.BASE_URL || "").origin &&
      (env.TRUSTED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .includes(u.origin)
    );
  } catch {
    return false;
  }
}
export function configurationIssues(
  env: Environment = process.env,
  role: "app" | "worker" | "cleanup" = "app",
) {
  const errors = new Set<string>();
  const need = (ok: unknown, name: string) => {
    if (!ok) errors.add(name);
  };
  const mode = appMode(env),
    remote = mode !== "development";
  need(
    !env.APP_ENV ||
      ["development", "staging", "production"].includes(env.APP_ENV),
    "APP_ENV",
  );
  need(
    ["development", "production", "test"].includes(
      env.NODE_ENV || "development",
    ),
    "NODE_ENV",
  );
  if (remote) need(env.NODE_ENV === "production", "NODE_ENV");
  if (role === "app") need(strongSecret(env.AUTH_SECRET), "AUTH_SECRET");
  let base: URL | undefined;
  try {
    base = new URL(env.BASE_URL || "");
  } catch {}
  need(
    base &&
      !base.username &&
      !base.password &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash &&
      (remote
        ? base.protocol === "https:"
        : ["http:", "https:"].includes(base.protocol) &&
          loopback(base.hostname)),
    "BASE_URL",
  );
  let database: URL | undefined;
  try {
    database = new URL(env.POSTGRES_URL || "");
  } catch {}
  need(
    database &&
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      database.hostname &&
      database.pathname.length > 1,
    "POSTGRES_URL",
  );
  if (remote) {
    need(
      database?.searchParams.get("sslmode") === "verify-full",
      "POSTGRES_URL_TLS",
    );
    if (role === "app") {
      need(env.SESSION_COOKIE_SECURE === "true", "SESSION_COOKIE_SECURE");
      const origins = (env.TRUSTED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim());
      need(
        base && origins.length === 1 && origins[0] === base.origin,
        "TRUSTED_ORIGINS",
      );
      need(
        env.TRUSTED_CLIENT_IP_HEADER === "x-mimi-client-ip",
        "TRUSTED_CLIENT_IP_HEADER",
      );
    }
    need(
      env.MEDIA_STORAGE_DRIVER !== "local" &&
        env.MEDIA_SCAN_MODE !== "development-manual" &&
        env.VIDEO_SANDBOX_MODE !== "development-prlimit",
      "DEVELOPMENT_MEDIA_FORBIDDEN",
    );
  }
  for (const field of [
    "PAYMENTS_ENABLED",
    "MEDIA_UPLOADS_ENABLED",
    "VIDEO_UPLOADS_ENABLED",
    "SIGNUP_ENABLED",
    "SESSION_COOKIE_SECURE",
    "VIDEO_WORKER_ENABLED",
  ])
    need(!env[field] || ["true", "false"].includes(env[field]!), field);
  need(env.PAYMENTS_ENABLED !== "true", "PAYMENTS_ENABLED");
  if (remote) need(env.PAYMENTS_ENABLED === "false", "PAYMENTS_ENABLED");
  if (mode === "staging") {
    if (role === "app") {
      need(
        env.STAGING_ACCESS_USERNAME &&
          /^[a-zA-Z0-9._-]{1,64}$/.test(env.STAGING_ACCESS_USERNAME),
        "STAGING_ACCESS_USERNAME",
      );
      need(
        strongSecret(env.STAGING_ACCESS_PASSWORD),
        "STAGING_ACCESS_PASSWORD",
      );
    }
    need(env.STAGING_DATA_ISOLATED === "true", "STAGING_DATA_ISOLATED");
  }
  if (env.HEALTHCHECK_TOKEN)
    need(strongSecret(env.HEALTHCHECK_TOKEN), "HEALTHCHECK_TOKEN");
  if (env.STAGING_ACCESS_PASSWORD)
    need(
      env.STAGING_ACCESS_PASSWORD !== env.AUTH_SECRET &&
        env.STAGING_ACCESS_PASSWORD !== env.HEALTHCHECK_TOKEN,
      "SEPARATE_ACCESS_SECRETS",
    );
  const media =
    env.MEDIA_STORAGE_DRIVER === "s3" || (remote && uploadsEnabled(env));
  if (remote && media) {
    need(env.MEDIA_STORAGE_DRIVER === "s3", "MEDIA_STORAGE_DRIVER");
    need(https(env.MEDIA_S3_ENDPOINT), "MEDIA_S3_ENDPOINT");
    for (const name of [
      "MEDIA_S3_REGION",
      "MEDIA_S3_BUCKET",
      "MEDIA_S3_ACCESS_KEY_ID",
      "MEDIA_S3_SECRET_ACCESS_KEY",
    ])
      need(env[name]?.trim(), name);
    need(
      /^[a-f0-9]{64}\.webp$/.test(env.MEDIA_HEALTHCHECK_KEY || ""),
      "MEDIA_HEALTHCHECK_KEY",
    );
  }
  if (remote && uploadsEnabled(env)) {
    need(
      https(env.MEDIA_SCANNER_URL) &&
        https(env.MEDIA_SCANNER_HEALTH_URL) &&
        env.MEDIA_SCANNER_TOKEN,
      "MEDIA_SCANNER",
    );
  }
  if (
    remote &&
    (videosEnabled(env) ||
      env.VIDEO_WORKER_ENABLED === "true" ||
      role === "worker")
  ) {
    need(
      env.MEDIA_UPLOADS_ENABLED === "true" &&
        env.VIDEO_UPLOADS_ENABLED === "true" &&
        env.VIDEO_WORKER_ENABLED === "true",
      "VIDEO_FEATURE_APPROVAL",
    );
    need(
      (env.VIDEO_SANDBOX_MODE || "bwrap") === "bwrap" &&
        /^[a-zA-Z0-9._/-]{8,160}$/.test(env.VIDEO_ISOLATION_VERIFICATION || ""),
      "VIDEO_ISOLATION_VERIFICATION",
    );
    need(
      https(env.VIDEO_SCANNER_URL) &&
        https(env.VIDEO_SCANNER_HEALTH_URL) &&
        env.VIDEO_SCANNER_TOKEN,
      "VIDEO_SCANNER",
    );
    need(
      env.VIDEO_WORK_ROOT?.startsWith("/") && env.VIDEO_WORK_ROOT !== "/",
      "VIDEO_WORK_ROOT",
    );
  }
  return [...errors];
}
export function assertConfiguration(
  role: "app" | "worker" | "cleanup" = "app",
  env: Environment = process.env,
) {
  const issues = configurationIssues(env, role);
  if (issues.length)
    throw new Error(
      `Invalid runtime configuration: ${issues.join(", ")}. Values are withheld.`,
    );
}
