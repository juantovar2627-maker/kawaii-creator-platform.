import { Suspense } from "react";
import { DiscoverDirectory } from "@/components/community/discover";
import { DemoNotice, PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Discover creators" };
export default function DiscoverPage() {
  return (
    <>
      <PageIntro
        eyebrow="A WORLD OF LITTLE WONDERS"
        title="Find your kind of people."
        description="The outfit that inspires you. The art that makes you pause. The creators who just get it. Your next favorite is here."
      />
      <DemoNotice />
      <Suspense fallback={<p role="status">Finding lovely people…</p>}>
        <DiscoverDirectory />
      </Suspense>
    </>
  );
}
