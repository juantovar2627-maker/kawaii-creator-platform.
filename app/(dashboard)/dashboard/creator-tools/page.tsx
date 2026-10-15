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
      <CreatorStudio />
    </>
  );
}
