import { SocialActivity } from "@/components/social/activity";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { AccountSafety } from "@/components/safety/account-safety";
import { PageIntro } from "@/components/community/primitives";
export const metadata = {
  title: "Community Safety",
  robots: { index: false, follow: false },
};
export default async function SafetyPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  const staff = await getStaffForUser(user.id);
  return (
    <>
      <PageIntro
        eyebrow="YOUR BOUNDARIES MATTER"
        title="Community Safety"
        description="Your real reports, account blocks, creator decisions, and requests for another review."
        action={
          staff && (
            <Link className="mimi-button secondary" href="/admin/moderation">
              Open moderation dashboard
            </Link>
          )
        }
      />
      <AccountSafety />
      <SocialActivity />
    </>
  );
}
