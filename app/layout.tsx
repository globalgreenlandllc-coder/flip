import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "flip", template: "%s · flip" },
  description: "Know if it's a good flip before you offer. Paste the listing, add the photos, get GO / TIGHT / PASS and what to remodel for the most profit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#0b1220",
              colorForeground: "#151b2b",
              colorBackground: "#ffffff",
              colorNeutral: "#151b2b",
              borderRadius: "0.625rem",
              fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
            },
            elements: {
              card: "shadow-none border border-ink-200 rounded-2xl",
              formButtonPrimary: "bg-ink-950 hover:bg-ink-900 text-white font-semibold",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
