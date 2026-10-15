import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Flower2,
  Gamepad2,
  Heart,
  Palette,
  ShieldCheck,
  Shirt,
  Sparkles,
  Stars,
  WandSparkles,
} from "lucide-react";
import { creators } from "@/lib/demo/community";
import {
  CreatorAvatar,
  DemoBadge,
  SectionHeading,
} from "@/components/community/primitives";
import { FeaturedCreators } from "@/components/community/home";
import { Feed } from "@/components/community/feed";
import { brand } from "@/lib/brand";

const worlds = [
  { name: "Fashion & style", caption: "Wear your own story", icon: Shirt },
  { name: "Cosplay", caption: "A little everyday magic", icon: WandSparkles },
  {
    name: "Art & illustration",
    caption: "Make something lovely",
    icon: Palette,
  },
  {
    name: "Lifestyle",
    caption: "Find joy in the little things",
    icon: Flower2,
  },
  { name: "Gaming", caption: "Cozy worlds, good company", icon: Gamepad2 },
];

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <Sparkles size={14} aria-hidden="true" />A softer corner of the
            internet
          </p>
          <h1 id="hero-title">
            Your people.
            <br />
            Your little corner.
            <br />
            <em>Your kind of magic.</em>
          </h1>
          <p className="hero-description">
            A home for self-expression, everyday creativity, and the people who
            make you feel a little more you.
          </p>
          <div className="hero-actions">
            <Link href="/sign-up" className="mimi-button primary">
              Find your people
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link href="/discover" className="mimi-button secondary">
              Explore creators
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="hero-people">
            <div className="avatar-stack">
              {creators.slice(0, 3).map((creator) => (
                <CreatorAvatar key={creator.id} creator={creator} size="xs" />
              ))}
            </div>
            <span>Different stories. One lovely little community.</span>
          </div>
        </div>
        <div className="hero-art">
          <Image
            src="/images/mimi-hero.png"
            alt="Original illustration of three adult creators sharing a cozy, pastel-filled art studio"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 600px) 100vw, 50vw"
          />
          <span className="hero-floating-note">
            <Heart
              size={13}
              fill="#d18fae"
              color="#bd7097"
              aria-hidden="true"
            />
            you belong here
          </span>
          <span className="hero-art-caption">
            An illustrated world of possibilities
          </span>
        </div>
      </section>
      <div className="home-values">
        <span>
          <ShieldCheck size={15} aria-hidden="true" />
          Kindness first
        </span>
        <span>
          <Heart size={15} aria-hidden="true" />
          Expression without labels
        </span>
        <span>
          <Stars size={15} aria-hidden="true" />A little room to bloom
        </span>
      </div>
      <section className="home-featured">
        <SectionHeading
          eyebrow="GOOD PEOPLE, LOVELY THINGS"
          title="Meet your next favorites"
          href="/discover"
          link="Discover everyone"
        />
        <FeaturedCreators />
        <div className="home-demo">
          <span>Fictional creators. Real inspiration for what comes next.</span>
          <DemoBadge>Meet the demo community</DemoBadge>
        </div>
      </section>
      <section>
        <SectionHeading
          eyebrow="FOLLOW YOUR CURIOSITY"
          title="Find your kind of lovely"
        />
        <div className="category-grid">
          {worlds.map((world) => (
            <Link
              key={world.name}
              href={`/discover?category=${encodeURIComponent(world.name)}`}
              className="category-card"
            >
              <world.icon aria-hidden="true" />
              <strong>{world.name}</strong>
              <small>{world.caption}</small>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <SectionHeading
          eyebrow="FROM THE COMMUNITY"
          title="A little inspiration for your day"
          href="/feed"
          link="Into the feed"
        />
        <Feed limit={2} />
      </section>
      <section className="join-banner">
        <div>
          <p className="eyebrow">THERE’S ROOM FOR EVERY VERSION OF YOU</p>
          <h2 className="mt-3">Make yourself a little space.</h2>
          <p>Come for the inspiration. Stay for the feeling of belonging.</p>
        </div>
        <Link href="/sign-up" className="mimi-button primary">
          Join {brand.name}
          <Heart size={15} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
