import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { getUser, getTeamForUser } from "@/lib/db/queries";
import { SWRConfig } from "swr";
import { PaymentsProvider } from "@/components/payments-provider";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { DemoProvider } from "@/components/community/demo-provider";
import { brand } from "@/lib/brand";
import { publicUser } from "@/lib/auth/public-user";

export const experimental_ppr = true;

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.className}>
      <body>
        <SWRConfig
          value={{
            fallback: {
              // We do NOT await here
              // Only components that read this data will suspend
              "/api/user": getUser().then(publicUser),
              "/api/team": getTeamForUser(),
            },
          }}
        >
          <PaymentsProvider enabled={isPaymentsEnabled()}>
            <DemoProvider>{children}</DemoProvider>
          </PaymentsProvider>
        </SWRConfig>
      </body>
    </html>
  );
}
