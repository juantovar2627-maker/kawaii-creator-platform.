import { SiteShell } from "@/components/community/site-shell";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SiteShell>{children}</SiteShell>;
}
