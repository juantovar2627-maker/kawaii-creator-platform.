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
      <DemoNotice />
      <Following />
    </>
  );
}
