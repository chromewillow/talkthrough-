import type { Metadata, Viewport } from "next";
import { Google_Sans, JetBrains_Mono, Newsreader } from "next/font/google";

import { Backdrop } from "@/components/talkthrough/backdrop";
import "./globals.css";

// Google's own typeface: open proportions and steady strokes that hold up on a dark background.
const sans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const reading = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Absolute base for social images: the production domain on Vercel, else localhost.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const description =
  "Paste a GitHub repository and get a calm, plain-English walkthrough of the code, written to be listened to.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Talkthrough — hear what your code is actually doing",
  description,
  applicationName: "Talkthrough",
  openGraph: { title: "Talkthrough", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Talkthrough", description },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${reading.variable} ${mono.variable}`}>
      <body>
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
