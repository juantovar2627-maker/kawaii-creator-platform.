import Link from "next/link";
import { CreatorStudio } from "@/components/community/creator-studio";
import { PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Creator studio" };
export default function CreatorToolsPage() {
  return (
    <>
      <PageIntro
        eyebrow="FOR WHATEVER YOU DREAM UP NEXT"
        title="Your creator studio."
        description="A little room for your next idea. Start with a draft; there’s no rush to be ready."
      />
      <div className="creator-policy-note">
        <strong>Ready for a real creator post?</strong>
        <p>
          Your post studio saves drafts and optional private photos, then sends
          the full version to staff review.
        </p>
        <Link className="mimi-button primary" href="/dashboard/posts">
          Open real post studio
        </Link>
      </div>
      <CreatorStudio />
    </>
  );
}
