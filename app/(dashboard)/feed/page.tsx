import { RealFeed } from "@/components/social/feed";
import { Feed, FeedAside } from "@/components/community/feed";
import { DemoNotice, PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Community feed" };
export default function FeedPage() {
  return (
    <>
      <PageIntro
        eyebrow="A LITTLE MOMENT OF JOY"
        title="The community corner."
        description="Fresh inspiration, little creative wins, and a few lovely things worth slowing down for."
      />
      <RealFeed />
      <h2 className="directory-section-title">Fictional demo inspiration</h2>
      <DemoNotice />
      <div className="feed-layout">
        <Feed />
        <FeedAside />
      </div>
    </>
  );
}
