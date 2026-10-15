"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Heart, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/community/primitives";
import { brand } from "@/lib/brand";
import { signIn, signUp } from "./actions";
import type { ActionState } from "@/lib/auth/middleware";

export function Login({ mode = "signin" }: { mode?: "signin" | "signup" }) {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const priceId = searchParams.get("priceId");
  const inviteId = searchParams.get("inviteId");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    mode === "signin" ? signIn : signUp,
    { error: "" },
  );
  const switchParams = new URLSearchParams();
  if (redirect) switchParams.set("redirect", redirect);
  if (priceId) switchParams.set("priceId", priceId);
  if (inviteId) switchParams.set("inviteId", inviteId);
  const switchPath = `${mode === "signin" ? "/sign-up" : "/sign-in"}${switchParams.size ? `?${switchParams}` : ""}`;

  return (
    <main className="login-page">
      <div className="login-illustration">
        <Image
          src="/images/mimi-hero.png"
          alt="Illustrated friends in a cozy creative studio"
          width={1536}
          height={1024}
          priority
          sizes="50vw"
        />
        <div className="login-art-caption">
          <p className="eyebrow text-white/80 mb-4">
            <Sparkles size={14} aria-hidden="true" />A LITTLE MORE YOU
          </p>
          <h2>
            Your people.
            <br />
            Your kind of magic.
          </h2>
          <p>
            A little place for your style, your stories, and all the things that
            make you, you.
          </p>
        </div>
      </div>
      <div className="login-form-side">
        <Brand />
        <p className="eyebrow">
          <Heart size={13} aria-hidden="true" />
          YOU BELONG HERE
        </p>
        <h1>
          {mode === "signin"
            ? "Sign in to your account"
            : "Create your account"}
        </h1>
        <p className="login-subtitle">
          {mode === "signin"
            ? "Your little corner of the internet is waiting."
            : `Make a little space for yourself on ${brand.name}.`}
        </p>
        <form action={formAction}>
          <input type="hidden" name="redirect" value={redirect || ""} />
          <input type="hidden" name="priceId" value={priceId || ""} />
          <input type="hidden" name="inviteId" value={inviteId || ""} />
          <div>
            <Label htmlFor="email" className="mb-2 block">
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={state.email}
              required
              maxLength={255}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label htmlFor="password" className="mb-2 block">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              minLength={8}
              maxLength={100}
              placeholder="At least 8 characters"
            />
          </div>
          {state?.error && (
            <p role="alert" className="text-[#b23255] text-xs">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            className="mimi-button primary"
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                A little moment…
              </>
            ) : (
              <>
                {mode === "signin" ? "Sign in" : "Sign up"}
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
        <p className="login-switch">
          {mode === "signin"
            ? "New to our little corner?"
            : "Already found your people?"}
          <Link href={switchPath}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </Link>
        </p>
        <p className="login-promise">
          A space for self-expression, respect, and a little everyday joy. Read
          our{" "}
          <Link
            href="/community-guidelines"
            className="underline underline-offset-2"
          >
            community promise
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
