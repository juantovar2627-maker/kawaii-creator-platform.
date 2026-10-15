import { Feed } from "@/components/community/feed";
import { DemoNotice, PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Saved inspiration" };
export default function SavedPage() {
  return (
    <>
      <PageIntro
        eyebrow="KEEP THE LOVELY THINGS CLOSE"
        title="Your inspiration collection."
        description="Outfits to revisit. Art that makes you smile. A little something for your next creative day."
      />
      <DemoNotice>
        Bookmarks are a browser-local demo, separate from your real account
        data.
      </DemoNotice>
      <Feed mode="saved" />
    </>
  );
}
