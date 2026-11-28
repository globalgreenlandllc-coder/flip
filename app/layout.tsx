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
  title: { default: "RenoFlip: know what to pay, see what you keep", template: "%s · RenoFlip" },
  description: "The investment workspace for house flips: the most you can offer, the renovation plan read from the photos, and the profit left after every project cost. Sold prices from public records where a house can be looked up, with an estimate not yet accuracy-tested; free during beta.",
  openGraph: {
    siteName: "RenoFlip",
    type: "website",
    title: "RenoFlip: know what to pay, see what you keep",
    description: "Paste a listing, add the photos: a renovation plan, the most you can offer, and what to check. Sold prices from public records where a house can be looked up; the estimate is not yet accuracy-tested.",
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
              // The sign-in button in the design's orange with ink letters, set by Clerk's own colour settings (a
              // class on its button can lose to Clerk's own styles).
              colorPrimary: "#ff6a3d",
              colorPrimaryForeground: "#111416",
              colorRing: "#b9411d",
              colorForeground: "#141c22",
              colorBackground: "#ffffff",
              colorNeutral: "#141c22",
              colorInput: "#ffffff",
              borderRadius: "0.6rem",
              fontFamily: "var(--font-jakarta), 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif",
            },
            elements: {
              card: "shadow-none border border-ink-200 rounded-2xl",
              formButtonPrimary: "font-bold normal-case shadow-none",
              // Text links: #b9411d (5.5:1 on white), not the button's orange (2.85:1).
              footerActionLink: { color: "#b9411d", fontWeight: 600 },
              formFieldAction: { color: "#b9411d" },
              formResendCodeLink: { color: "#b9411d" },
              identityPreviewEditButton: { color: "#b9411d" },
              formButtonReset: { color: "#b9411d" },
              backLink: { color: "#b9411d" },
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
