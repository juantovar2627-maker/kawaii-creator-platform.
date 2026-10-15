import { z } from "zod";
import { reportReasons } from "@/lib/moderation/validation";
const id = z.number().int().positive();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) =>
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
          value,
        ),
      "Remove unsupported control characters.",
    );
const body = text(4000).pipe(
  z.string().min(1, "Write a little something first."),
);
const comment = text(600).pipe(z.string().min(1, "Write a comment first."));
const revision = { id, revision: id };
export const socialInput = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("block_comment_author"), commentId: id })
    .strict(),
  z
    .object({
      action: z.literal("follow"),
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z][a-z0-9_]{2,29}$/),
      following: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_post"),
      title: text(120).default(""),
      body,
    })
    .strict(),
  z
    .object({
      action: z.literal("edit_post"),
      ...revision,
      title: text(120).default(""),
      body,
    })
    .strict(),
  z.object({ action: z.literal("delete_post"), ...revision }).strict(),
  z.object({ action: z.literal("submit_post"), ...revision }).strict(),
  z
    .object({ action: z.literal("like"), postId: id, liked: z.boolean() })
    .strict(),
  z
    .object({ action: z.literal("save"), postId: id, saved: z.boolean() })
    .strict(),
  z
    .object({ action: z.literal("comment"), postId: id, body: comment })
    .strict(),
  z
    .object({ action: z.literal("edit_comment"), ...revision, body: comment })
    .strict(),
  z.object({ action: z.literal("delete_comment"), ...revision }).strict(),
  z
    .object({
      action: z.literal("report"),
      target: z.enum(["post", "comment"]),
      id,
      reason: z.enum(reportReasons),
      explanation: text(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("appeal"),
      decisionId: id,
      explanation: text(1000).pipe(z.string().min(10)),
    })
    .strict(),
]);
export const socialQuery = z
  .object({
    view: z
      .enum([
        "feed",
        "post",
        "creator",
        "following",
        "comments",
        "workspace",
        "activity",
      ])
      .default("feed"),
    scope: z
      .enum(["main", "home", "creator", "following", "saved"])
      .default("main"),
    username: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,29}$/)
      .optional(),
    id: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
const decision = {
  id,
  revision: id,
  reason: text(1000).pipe(z.string().min(10)),
  internalNote: text(1000).default(""),
};
export const socialAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_post"), ...decision }).strict(),
  z.object({ action: z.literal("reject_post"), ...decision }).strict(),
  z.object({ action: z.literal("remove_post"), ...decision }).strict(),
  z.object({ action: z.literal("restore_post"), ...decision }).strict(),
  z.object({ action: z.literal("remove_comment"), ...decision }).strict(),
  z.object({ action: z.literal("restore_comment"), ...decision }).strict(),
  z
    .object({
      action: z.literal("resolve_report"),
      id,
      status: z.enum(["resolved", "dismissed"]),
      resolution: text(1000).pipe(z.string().min(10)),
      internalNote: text(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("review_appeal"),
      id,
      resolution: text(1000).pipe(z.string().min(10)),
      internalNote: text(1000).default(""),
    })
    .strict(),
]);
export const socialAdminQuery = z
  .object({
    kind: z.enum(["posts", "comments", "reports", "appeals"]).default("posts"),
    status: z
      .enum([
        "all",
        "pending",
        "published",
        "rejected",
        "removed",
        "visible",
        "open",
        "resolved",
        "dismissed",
        "reviewed",
      ])
      .default("pending"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
