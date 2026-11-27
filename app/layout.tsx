import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import { VisitBeacon } from "@/components/visit-beacon";
import "./globals.css";

// Plus Jakarta Sans, kept with the app (SIL Open Font License, app/fonts/OFL.txt): nothing is fetched to build or show it.
const jakarta = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "./fonts/plus-jakarta-sans-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-700.ttf", weight: "700", style: "normal" },
    { path: "./fonts/plus-jakarta-sans-800.ttf", weight: "800", style: "normal" },
  ],
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Renoflip: see the potential, know the profit", template: "%s · Renoflip" },
  description: "Turn a listing into a renovation plan, the most you can offer, and the numbers behind them: real sold prices, your costs, and what to check before you buy.",
  openGraph: {
    siteName: "Renoflip",
    type: "website",
    title: "Renoflip: see the potential, know the profit",
    description: "Paste a listing, add the photos. A renovation plan, the most you can offer, and what to check, worked out from real sold prices.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#153d35",
              colorForeground: "#162e28",
              colorBackground: "#ffffff",
              colorNeutral: "#162e28",
              colorInput: "#ffffff",
              borderRadius: "0.6rem",
              fontFamily: "var(--font-jakarta), 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
            },
            elements: {
              card: "shadow-none border border-ink-200 rounded-2xl",
              formButtonPrimary: "bg-ink-950 hover:bg-[#245648] text-white font-semibold normal-case",
              footerActionLink: "text-ink-950 font-semibold",
            },
          }}
        >
          {children}
          <VisitBeacon />
        </ClerkProvider>
      </body>
    </html>
  );
}
