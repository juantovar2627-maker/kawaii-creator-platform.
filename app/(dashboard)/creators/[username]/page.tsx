import { notFound } from "next/navigation";
import { cache } from "react";
import { findCreator } from "@/lib/demo/community";
import { getPublicCreator } from "@/lib/creators/queries";
import { CreatorProfile } from "@/components/community/creator-profile";
import { RealCreatorProfile } from "@/components/creators/public-profile";

// Request-time resolution keeps hidden profiles private immediately. Disabling
// PPR here lets notFound set HTTP 404 before any page shell is streamed.
export const dynamic = "force-dynamic";
export const experimental_ppr = false;
const resolveCreator = cache(async (username: string) => {
  const demo = findCreator(username.toLowerCase());
  return demo
    ? { demo, real: null }
    : { demo: null, real: await getPublicCreator(username) };
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { demo, real } = await resolveCreator((await params).username);
  return {
    title: demo
      ? `${demo.name} · Demo creator`
      : real
        ? `${real.displayName} · Creator`
        : "Creator not found",
    robots: { index: false, follow: false },
  };
}
export default async function CreatorPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { demo, real } = await resolveCreator((await params).username);
  if (demo) return <CreatorProfile creator={demo} />;
  if (!real) notFound();
  return <RealCreatorProfile creator={real} />;
}
