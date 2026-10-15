import { redirect } from "next/navigation";
import { getUser } from "@/lib/db/queries";
import { PageIntro } from "@/components/community/primitives";
import { PostWorkspace } from "@/components/social/workspace";
export const metadata = {
  title: "Your real creator posts",
  robots: { index: false, follow: false },
};
export default async function PostsPage() {
  if (!(await getUser())) redirect("/sign-in");
  return (
    <>
      <PageIntro
        eyebrow="WORDS WITH A LITTLE HEART"
        title="Your words, your little world."
        description="Text, optional photos or short videos, saved drafts, and a thoughtful review before anything goes public."
      />
      <PostWorkspace />
    </>
  );
}
