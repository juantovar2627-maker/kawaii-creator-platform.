"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bookmark,
  Heart,
  LayoutDashboard,
  LockKeyhole,
  PenLine,
  Sparkles,
  Users,
} from "lucide-react";

const items = [
  { href: "/dashboard", label: "My space", icon: LayoutDashboard },
  { href: "/dashboard/creator-space", label: "My Creator Space", icon: Heart },
  { href: "/dashboard/safety", label: "Community Safety", icon: LockKeyhole },
  { href: "/dashboard/general", label: "Edit profile", icon: PenLine },
  { href: "/dashboard/saved", label: "Saved posts", icon: Bookmark },
  { href: "/dashboard/creator-tools", label: "Creator studio", icon: Sparkles },
  { href: "/dashboard/security", label: "Security", icon: LockKeyhole },
  { href: "/dashboard/activity", label: "Activity", icon: Activity },
  { href: "/dashboard/team", label: "Workspace", icon: Users },
];

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <>
      <nav className="account-tabs" aria-label="Account navigation">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? "active" : ""}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <item.icon size={14} aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="account-settings">{children}</div>
    </>
  );
}
