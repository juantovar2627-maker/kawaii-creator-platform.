import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { getUser, getTeamForUser } from "@/lib/db/queries";
import { SessionDataProvider } from "@/components/session-data-provider";
import { PaymentsProvider } from "@/components/payments-provider";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { DemoProvider } from "@/components/community/demo-provider";
import { brand } from "@/lib/brand";
import { appMode } from "@/lib/config/runtime";
import { publicUser } from "@/lib/auth/public-user";


export const metadata: Metadata = {
  title: {
    default: `${brand.name} — ${brand.tagline}`,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const manrope = Manrope({ subsets: ["latin"] });

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SWR 2.3.x can notify a subscriber during React's promise fallback render
  // before its returnedData binding exists. Resolved session fallbacks avoid
  // that race when multiple social components read the same account key.
  const [user, team] = await Promise.all([getUser(), getTeamForUser()]);
  return (
    <html lang="en" className={manrope.className}>
      <body>
        {appMode() === "staging" && <aside className="staging-indicator" aria-label="Private staging environment">Private staging · synthetic test data only · payments and uploads disabled by default</aside>}
        <SessionDataProvider
          key={user?.id ?? "anonymous"}
          fallback={{
            "/api/user": publicUser(user),
            "/api/team": team,
          }}
        >
          <PaymentsProvider enabled={isPaymentsEnabled()}>
            <DemoProvider>{children}</DemoProvider>
          </PaymentsProvider>
        </SessionDataProvider>
      </body>
    </html>
  );
}
