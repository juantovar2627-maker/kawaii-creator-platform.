import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Heart, PenLine, Sparkles } from "lucide-react";
import { getUser } from "@/lib/db/queries";
import { DemoBadge } from "@/components/community/primitives";

export const metadata = { title: "Your profile" };
export default async function ProfilePage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return (
    <>
      <div className="profile-banner">
        <div className="personal-banner-decoration" aria-hidden="true">
          <span>✿</span>
          <span>♡</span>
          <span>✦</span>
        </div>
        <DemoBadge>Your real account</DemoBadge>
      </div>
      <div className="profile-identity">
        <span className="account-avatar personal-avatar" aria-hidden="true">
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </span>
        <Link href="/dashboard/general" className="mimi-button secondary">
          <PenLine size={15} aria-hidden="true" />
          Edit profile
        </Link>
      </div>
      <div className="profile-main">
        <h1>{user.name || "Your little corner"}</h1>
        <p className="profile-handle">
          Only you can see this account overview.
        </p>
        <p className="profile-bio">
          Your next chapter starts with you. Add your name in profile settings,
          explore creators, and collect a little inspiration while your creative
          space takes shape.
        </p>
      </div>
      <div className="account-tool-grid">
        <div className="account-tool">
          <Heart size={25} aria-hidden="true" />
          <div>
            <h2>Find your people.</h2>
            <p>
              Explore the fictional creator community and try a local follow.
            </p>
            <Link href="/discover" className="text-link">
              Discover creators
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="account-tool">
          <Sparkles size={25} aria-hidden="true" />
          <div>
            <h2>Make something lovely.</h2>
            <p>
              Try a draft in the creator studio. Your account is real;
              publishing and public creator profiles are future features.
            </p>
            <Link href="/dashboard/creator-tools" className="text-link">
              Your creator studio
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
