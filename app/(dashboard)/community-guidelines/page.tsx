import { Flower2, Heart, ShieldCheck, UserRoundCheck } from "lucide-react";
import { PageIntro } from "@/components/community/primitives";

export const metadata = { title: "Community guidelines" };
const promises = [
  {
    title: "Expression belongs here.",
    icon: Flower2,
    text: "Fashion, cosplay, art, and everyday creativity look different on everyone. Respect names, pronouns, identities, and the freedom to be yourself.",
  },
  {
    title: "Kindness is the baseline.",
    icon: Heart,
    text: "No harassment, hate, bullying, or targeted cruelty. Be thoughtful with feedback. You never have to earn your right to be treated kindly.",
  },
  {
    title: "Boundaries come first.",
    icon: UserRoundCheck,
    text: "Share only content you own or have permission to use. Respect privacy and consent. This is a non-explicit community; explicit sexual content is not part of this space.",
  },
  {
    title: "Make room for a safer space.",
    icon: ShieldCheck,
    text: "Use the menu on a post or creator to preview reporting and blocking. In Phase 1, blocks hide demo content only in this browser and report drafts are not submitted or monitored. Real reporting, review, appeals, and enforcement need a moderation backend.",
  },
];
export default function GuidelinesPage() {
  return (
    <>
      <PageIntro
        eyebrow="OUR COMMUNITY PROMISE"
        title="A kinder corner, together."
        description="The best kind of community makes a little room for everyone to bloom. Here’s the foundation we’re building on."
      />
      <div className="guidelines-grid">
        {promises.map((promise) => (
          <section className="guideline" key={promise.title}>
            <promise.icon size={29} strokeWidth={1.5} aria-hidden="true" />
            <h2>{promise.title}</h2>
            <p>{promise.text}</p>
          </section>
        ))}
      </div>
    </>
  );
}
