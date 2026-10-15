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
    text: "Share only content you own or have permission to use, including consent from people shown. Never expose addresses, IDs, intimate images, or other private information without permission. This is a non-explicit community: no sexual or exploitative content. Photos involving minors require appropriate consent and must never be sexualized. Report suspected exploitation; do not download or redistribute it.",
  },
  {
    title: "Make room for a safer space.",
    icon: ShieldCheck,
    text: "Sign in to report or block a real creator from their profile. Reports are saved for moderator review; account blocks persist across devices and hide signed-in creator surfaces, while public information remains accessible anonymously. Review your reports, blocks, creator decisions, and requests for another review in Community Safety. Fictional demo reports and blocks stay separate in this browser.",
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
