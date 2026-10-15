import { notFound } from "next/navigation";
import { creators, findCreator } from "@/lib/demo/community";
import { CreatorProfile } from "@/components/community/creator-profile";

// This phase only exposes the declared fictional profiles. Reject unknown
// usernames before the streamed page shell can turn a not-found into HTTP 200.
export const dynamicParams = false;

export function generateStaticParams() {
  return creators.map((creator) => ({ username: creator.username }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const creator = findCreator((await params).username);
  return {
    title: creator ? `${creator.name} · Demo creator` : "Creator not found",
  };
}
export default async function CreatorPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const creator = findCreator((await params).username);
  if (!creator) notFound();
  return <CreatorProfile creator={creator} />;
}
