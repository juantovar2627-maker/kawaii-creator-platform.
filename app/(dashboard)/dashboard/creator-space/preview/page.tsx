import { redirect } from "next/navigation";
import { getUser } from "@/lib/db/queries";
import { getOwnCreator } from "@/lib/creators/queries";
import { RealCreatorProfile } from "@/components/creators/public-profile";
export const metadata = {
  title: "Your creator preview",
  robots: { index: false, follow: false },
};
export default async function CreatorPreviewPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  const profile = await getOwnCreator(user.id);
  if (!profile) redirect("/dashboard/creator-space");
  return <RealCreatorProfile creator={profile} preview />;
}
