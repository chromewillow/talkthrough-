import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono, Newsreader } from "next/font/google";

import { Backdrop } from "@/components/talkthrough/backdrop";
import "./globals.css";

const serif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const sans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
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

export const metadata: Metadata = {
  title: "Talkthrough — hear what your code does",
  description:
    "Paste a GitHub repository and get a calm, plain-English walkthrough of the code, written to be listened to.",
  applicationName: "Talkthrough",
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${reading.variable} ${mono.variable}`}>
      <body>
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
