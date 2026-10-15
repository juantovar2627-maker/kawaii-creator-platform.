import { z } from "zod";
export const reportReasons = [
  "Harassment or bullying",
  "Spam",
  "Impersonation",
  "Privacy violation",
  "Non-consensual content",
  "Explicit material",
  "Moderation evasion",
] as const;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      "Remove unsupported control characters.",
    );
const id = z.number().int().positive();
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,29}$/);
export const safetyInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("report"),
      username,
      reason: z.enum(reportReasons),
      explanation: text(1000).default(""),
    })
    .strict(),
  z.object({ action: z.literal("block"), username }).strict(),
  z.object({ action: z.literal("unblock"), blockId: id }).strict(),
  z
    .object({
      action: z.literal("appeal"),
      decisionId: id,
      explanation: text(1000).pipe(
        z.string().min(10, "Tell us a little more (at least 10 characters)."),
      ),
    })
    .strict(),
]);
const decision = {
  profileId: id,
  revision: id,
  reason: text(1000).pipe(
    z
      .string()
      .min(10, "Give a clear creator-visible reason (at least 10 characters)."),
  ),
  internalNote: text(1000).default(""),
};
export const adminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), ...decision }).strict(),
  z.object({ action: z.literal("reject"), ...decision }).strict(),
  z.object({ action: z.literal("suspend"), ...decision }).strict(),
  z.object({ action: z.literal("restore"), ...decision }).strict(),
  z
    .object({
      action: z.literal("resolve_report"),
      reportId: id,
      status: z.enum(["resolved", "dismissed"]),
      resolution: text(1000).pipe(z.string().min(10)),
      internalNote: text(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("review_appeal"),
      appealId: id,
      resolution: text(1000).pipe(z.string().min(10)),
      internalNote: text(1000).default(""),
    })
    .strict(),
]);
export const queueInput = z
  .object({
    kind: z
      .enum(["profiles", "reports", "appeals", "activity", "profile"])
      .default("profiles"),
    status: z
      .enum([
        "all",
        "pending",
        "approved",
        "rejected",
        "suspended",
        "open",
        "resolved",
        "dismissed",
        "reviewed",
      ])
      .default("pending"),
    q: z.string().trim().max(80).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    id: z.coerce.number().int().positive().optional(),
  })
  .strict();
