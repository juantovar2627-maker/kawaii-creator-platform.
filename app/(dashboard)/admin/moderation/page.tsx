import { SocialModeration } from "@/components/social/moderation";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { ModerationDashboard } from "@/components/safety/moderation-dashboard";
import { PageIntro } from "@/components/community/primitives";
export const dynamic = "force-dynamic";
export const experimental_ppr = false;
export const metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};
export default async function ModerationPage() {
  const user = await getUser();
  if (!user || !(await getStaffForUser(user.id)))
    return (
      <section className="account-panel">
        <h1>Access denied</h1>
        <p>Staff authorization required.</p>
      </section>
    );
  return (
    <>
      <PageIntro
        eyebrow="CARE FOR THE COMMUNITY"
        title="A kinder corner starts here."
        description="Review creator spaces, listen to reports, and keep every decision clear and accountable."
      />
      <ModerationDashboard />
      <SocialModeration />
    </>
  );
}
