import { Suspense } from "react";
import { DiscoverDirectory } from "@/components/community/discover";
import { DemoNotice, PageIntro } from "@/components/community/primitives";
import { getDiscoverableCreators } from "@/lib/creators/queries";

export const metadata = { title: "Discover creators" };
export const dynamic = "force-dynamic";
export default async function DiscoverPage() {
  const realCreators = await getDiscoverableCreators();
  return (
    <>
      <PageIntro
        eyebrow="A WORLD OF LITTLE WONDERS"
        title="Find your kind of people."
        description="The outfit that inspires you. The art that makes you pause. The creators who just get it. Your next favorite is here."
      />
      <DemoNotice>
        Community profiles are real and appear after discovery approval. The six
        fictional examples are labeled separately; their social interactions
        remain browser-local demos. Unlisted profiles are accessible only by
        direct link.
      </DemoNotice>
      <Suspense fallback={<p role="status">Finding lovely people…</p>}>
        <DiscoverDirectory realCreators={realCreators} />
      </Suspense>
    </>
  );
}
