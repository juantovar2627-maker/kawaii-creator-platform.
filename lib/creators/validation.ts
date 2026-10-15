import { z } from "zod";
import { creatorCategories } from "./presets";

export const reservedUsernames = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "billing",
  "community",
  "community-guidelines",
  "creators",
  "dashboard",
  "discover",
  "feed",
  "following",
  "help",
  "login",
  "logout",
  "mimi",
  "moderation",
  "notifications",
  "null",
  "payments",
  "pricing",
  "profile",
  "root",
  "security",
  "settings",
  "sign-in",
  "sign-up",
  "signup",
  "signin",
  "staff",
  "stripe",
  "support",
  "system",
  "undefined",
  "www",
  // Fictional creators retain their existing routes permanently.
  "yukibloom",
  "lunamoon",
  "kaistudio",
  "momopeach",
  "rencloud",
  "solsprout",
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters for your username.")
  .max(30, "Usernames can have at most 30 characters.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Start with a letter; use only letters, numbers, and underscores.",
  )
  .refine(
    (value) => !reservedUsernames.has(value),
    "That username is reserved. Choose another.",
  );

function publicHttpsUrl(value: string, hosts?: string[]) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.includes(".") &&
      !/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) &&
      !/^[\d.]+$/.test(url.hostname) &&
      !url.hostname.includes(":") &&
      (!hosts || hosts.includes(url.hostname))
    );
  } catch {
    return false;
  }
}
const link = (hosts?: string[]) =>
  z
    .string()
    .trim()
    .max(300)
    .refine(
      (value) => publicHttpsUrl(value, hosts),
      "Use a public HTTPS link for the selected website.",
    )
    .default("");
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) =>
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
          value,
        ),
      "Please remove unsupported control characters.",
    );

export const creatorInputSchema = z
  .object({
    username: usernameSchema,
    displayName: safeText(80).pipe(z.string().min(1, "Add a display name.")),
    biography: safeText(1000).default(""),
    theme: z.enum(["pink", "lavender", "peach", "mint"]).default("pink"),
    avatar: z.enum(["flower", "star", "bow", "cloud"]).default("flower"),
    banner: z.enum(["blossom", "daydream", "sunrise"]).default("blossom"),
    categories: z
      .array(z.enum(creatorCategories))
      .min(1, "Choose a category.")
      .max(3)
      .refine(
        (value) => new Set(value).size === value.length,
        "Choose each category once.",
      ),
    websiteUrl: link(),
    instagramUrl: link(["instagram.com", "www.instagram.com"]),
    youtubeUrl: link(["youtube.com", "www.youtube.com", "youtu.be"]),
    visibility: z.enum(["hidden", "unlisted", "listed"]).default("unlisted"),
    communityAccepted: z.literal(true, {
      errorMap: () => ({
        message: "Please agree to our non-explicit community rules.",
      }),
    }),
  })
  .strict();
export type CreatorInput = z.infer<typeof creatorInputSchema>;
