import Link from "next/link";
import { ArrowUpRight, Flower2, Sparkles } from "lucide-react";
import { brand } from "@/lib/brand";
import type { Artwork, Creator } from "@/lib/demo/community";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label={`${brand.name} home`}>
      <span className="brand-mark" aria-hidden="true">
        <Flower2 strokeWidth={1.65} />
      </span>
      {!compact && (
        <span>
          {brand.name.toLowerCase()}
          <span className="brand-dot">✦</span>
        </span>
      )}
    </Link>
  );
}

export function DemoBadge({
  children = "Demo community",
}: {
  children?: React.ReactNode;
}) {
  return (
    <span className="demo-badge">
      <Sparkles size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

export function DemoNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="demo-notice">
      <Sparkles size={15} aria-hidden="true" />
      <p>
        {children ||
          "Meet our fictional creators. Follows, likes, saves, and comments are a local demo—only visible in this browser."}
      </p>
    </div>
  );
}

export function CreatorAvatar({
  creator,
  size = "md",
}: {
  creator: Creator;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  return (
    <span
      role="img"
      aria-label={`Illustrated portrait of ${creator.name}`}
      className={`creator-avatar avatar-${size}`}
      style={{
        backgroundImage:
          "url(/_next/image?url=%2Fimages%2Fmimi-hero.png&w=1080&q=75)",
        backgroundPosition: creator.portrait,
        backgroundColor: creator.color,
      }}
    />
  );
}

export function ArtworkPanel({
  art,
  label,
  className = "",
}: {
  art: Artwork;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`artwork art-${art} ${className}`}
    />
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">
          <Sparkles size={14} aria-hidden="true" />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        <p className="intro-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  href,
  link = "Explore more",
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  link?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {href && (
        <Link href={href} className="text-link">
          {link}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  href = "/discover",
  action = "Discover creators",
  onAction,
}: {
  title: string;
  children: React.ReactNode;
  href?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-flower">
        <Flower2 size={30} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {onAction ? (
        <button className="mimi-button secondary" onClick={onAction}>
          {action}
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      ) : (
        <Link href={href} className="mimi-button secondary">
          {action}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
