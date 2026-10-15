import { z } from "zod";

const ids = z.array(z.string().max(80)).max(100);
export const demoStateSchema = z.object({
  following: ids,
  liked: ids,
  saved: ids,
  blocked: ids,
  comments: z.record(
    z
      .array(z.object({ id: z.string(), text: z.string().min(1).max(500) }))
      .max(30),
  ),
  reports: z
    .array(
      z.object({
        target: z.string().max(100),
        reason: z.string().max(80),
        details: z.string().max(1000),
      }),
    )
    .max(50),
  notificationsRead: z.boolean(),
});

export type DemoState = z.infer<typeof demoStateSchema>;
export const emptyDemoState: DemoState = {
  following: [],
  liked: [],
  saved: [],
  blocked: [],
  comments: {},
  reports: [],
  notificationsRead: false,
};
export const demoStorageKey = "mimi-community-demo-v1";
