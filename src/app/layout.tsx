import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Agenda",
  description: "Notes and agenda — a clean, extensible foundation.",
};

// viewportFit cover enables env(safe-area-inset-*) on iOS, which the bubble
// canvas controls use to stay clear of the home indicator / Safari toolbar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      {/* `dark` is permanent: the redesign is a committed dark theme, and the
          class-strategy @custom-variant in globals.css keys off it so every
          existing `dark:` utility applies unconditionally. */}
      <html lang="en" className={`dark ${geist.variable}`}>
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
