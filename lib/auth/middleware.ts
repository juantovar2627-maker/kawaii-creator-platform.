import { z } from "zod";
import {
  actionOriginAllowed,
  authenticationAttempt,
  consumeAuthLimit,
} from "./abuse";
import { signupEnabled } from "@/lib/config/runtime";
import { TeamDataWithMembers, User } from "@/lib/db/schema";
import { getTeamForUser, getUser } from "@/lib/db/queries";
import { redirect } from "next/navigation";

export type ActionState = {
  error?: string;
  success?: string;
  [key: string]: any; // This allows for additional properties
};

async function privateAction<T>(
  work: () => Promise<T>,
): Promise<T | ActionState> {
  try {
    return await work();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT;")
    )
      throw error;
    console.error("Authentication operation failed");
    return { error: "Unable to complete this request. Please try again." };
  }
}

type ValidatedActionFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
) => Promise<T>;

export function validatedAction<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>,
  authKind?: "signin" | "signup",
) {
  return async (prevState: ActionState, formData: FormData) =>
    privateAction(async () => {
      if (authKind === "signup" && !signupEnabled())
        return {
          error:
            "Registration is unavailable. Ask your trusted operator for access.",
        };
      if (
        !(authKind
          ? await authenticationAttempt(authKind, formData)
          : await actionOriginAllowed())
      )
        return {
          error:
            "Unable to continue. Please wait before trying again from this website.",
        };
      const result = schema.safeParse(Object.fromEntries(formData));
      if (!result.success) {
        return { error: result.error.errors[0].message };
      }

      return action(result.data, formData);
    });
}

type ValidatedActionWithUserFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: User,
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>,
) {
  return async (prevState: ActionState, formData: FormData) =>
    privateAction(async () => {
      if (!(await actionOriginAllowed()))
        return { error: "This request must come from this website." };
      const user = await getUser();
      if (!user) {
        throw new Error("User is not authenticated");
      }
      if (!(await consumeAuthLimit("account", String(user.id), 20, 60)))
        return {
          error: "Too many account changes. Please wait and try again.",
        };

      const result = schema.safeParse(Object.fromEntries(formData));
      if (!result.success) {
        return { error: result.error.errors[0].message };
      }

      return action(result.data, formData, user);
    });
}

type ActionWithTeamFunction<T> = (
  formData: FormData,
  team: TeamDataWithMembers,
) => Promise<T>;

export function withTeam<T>(action: ActionWithTeamFunction<T>) {
  return async (formData: FormData): Promise<T> => {
    if (!(await actionOriginAllowed()))
      throw new Error("Invalid request origin.");
    const user = await getUser();
    if (!user) {
      redirect("/sign-in");
    }

    const team = await getTeamForUser();
    if (!team) {
      throw new Error("Team not found");
    }

    return action(formData, team);
  };
}
