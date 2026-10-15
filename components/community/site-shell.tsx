"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR, { mutate } from "swr";
import {
  ArrowUpRight,
  Bell,
  Bookmark,
  Compass,
  Heart,
  Home,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Flower2,
} from "lucide-react";
import { signOut } from "@/app/(login)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { brand } from "@/lib/brand";
import { Brand } from "./primitives";
import { useDemo } from "./demo-provider";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/following", label: "Following", icon: Heart },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

function AccountMenu() {
  const { data: user } = useSWR("/api/user", (url) =>
    fetch(url).then((response) => response.json()),
  );
  const router = useRouter();
  if (!user)
    return (
      <div className="header-account">
        <Link href="/sign-in" className="header-signin">
          Log in
        </Link>
        <Link href="/sign-up" className="mimi-button primary small">
          Join {brand.name} <Heart size={14} aria-hidden="true" />
        </Link>
      </div>
    );
  return (
    <div className="header-account">
      <Link href="/dashboard" className="header-signin">
        My little space
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="account-avatar"
          aria-label="Open account menu"
        >
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href="/dashboard">
              <UserRound size={16} />
              My account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/general">
              <Settings size={16} />
              Edit profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              await signOut();
              await mutate("/api/user");
              await mutate("/api/team");
              router.push("/");
              router.refresh();
            }}
          >
            <LogOut size={16} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const { state } = useDemo();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <form
            className="header-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              window.location.assign(
                `/discover?q=${encodeURIComponent(query)}`,
              );
            }}
          >
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search creators"
              placeholder="Find your people, find your inspiration…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span aria-hidden="true">✦</span>
          </form>
          <Suspense
            fallback={
              <Link href="/sign-in" className="mimi-button secondary small">
                Your account
              </Link>
            }
          >
            <AccountMenu />
          </Suspense>
        </div>
      </header>
      <div className="site-body">
        <aside className="desktop-sidebar">
          <nav aria-label="Main navigation">
            {navigation.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href) ||
                    (item.href === "/settings" &&
                      pathname.startsWith("/dashboard"));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <item.icon size={19} strokeWidth={1.7} aria-hidden="true" />
                  {item.label}
                  {item.href === "/notifications" &&
                    !state.notificationsRead && (
                      <span
                        className="nav-preview-dot"
                        aria-label="Demo notification preview"
                      />
                    )}
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-divider" />
          <p className="sidebar-label">YOUR LITTLE CORNER</p>
          <nav aria-label="Community shortcuts">
            <Link href="/feed" className="sidebar-link">
              <Users size={18} aria-hidden="true" />
              Community feed
            </Link>
            <Link href="/dashboard/saved" className="sidebar-link">
              <Bookmark size={18} aria-hidden="true" />
              Saved inspiration
            </Link>
          </nav>
          <div className="sidebar-invite">
            <span className="sidebar-flower" aria-hidden="true">
              ✿
            </span>
            <h3>A space to bloom.</h3>
            <p>
              Your style. Your stories.
              <br />
              Your kind of people.
            </p>
            <Link href="/sign-up">
              Find your little corner
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <Link href="/community-guidelines" className="guidelines-link">
            <ShieldCheck size={15} aria-hidden="true" />
            Kindness lives here
          </Link>
          <div className="sidebar-footer">
            <span>© {brand.name} · Phase 1 preview</span>
            <span>
              Made for a little more you <Heart size={10} aria-hidden="true" />
            </span>
          </div>
        </aside>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
          <footer className="content-footer">
            <span>
              <Flower2 size={15} aria-hidden="true" /> {brand.tagline}
            </span>
            <Link href="/community-guidelines">
              Community guidelines <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </footer>
        </main>
      </div>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
            className={pathname === item.href ? "active" : ""}
          >
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
