import { Suspense } from "react";
import Link from "next/link";
import { Login } from "../login";
import { signupEnabled } from "@/lib/config/runtime";
export const dynamic = "force-dynamic";
export default function SignUpPage() {
  if (!signupEnabled())
    return (
      <main className="section-wrap section-space">
        <h1>Registration is unavailable</h1>
        <p>Ask your trusted operator for tester access.</p>
        <Link href="/sign-in" className="mimi-button primary">
          Sign in
        </Link>
      </main>
    );
  return (
    <Suspense>
      <Login mode="signup" />
    </Suspense>
  );
}
