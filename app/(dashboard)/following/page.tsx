import { RealFollowing } from "@/components/social/follow";
import { RealFeed } from "@/components/social/feed";
import { Following } from "@/components/community/following";
import { DemoNotice, PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Following" };
export default function FollowingPage() {
  return (
    <>
      <PageIntro
        eyebrow="YOUR OWN LITTLE ORBIT"
        title="A feed that feels like you."
        description="All the lovely things from the creators you’ve chosen to keep close."
      />
      <RealFollowing />
      <RealFeed scope="following" title="Notes from your real creator circle" />
      <h2 className="directory-section-title">Fictional demo inspiration</h2>
      <DemoNotice />
      <Following />
    </>
  );
}
