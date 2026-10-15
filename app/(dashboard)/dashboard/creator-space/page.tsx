import { redirect } from "next/navigation";
import { getUser } from "@/lib/db/queries";
import { getOwnCreator } from "@/lib/creators/queries";
import { CreatorProfileEditor } from "@/components/creators/profile-editor";
export const metadata = {
  title: "My Creator Space",
  robots: { index: false, follow: false },
};
export default async function CreatorSpacePage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return <CreatorProfileEditor initialProfile={await getOwnCreator(user.id)} />;
}
