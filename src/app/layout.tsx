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
  // `dark` is permanent: the redesign is a committed dark theme, and the
  // class-strategy @custom-variant in globals.css keys off it so every
  // existing `dark:` utility applies unconditionally.
  const page = (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );

  // Same graceful degradation as the DB: without a Clerk key the app (and
  // `next build`'s static prerender) must still work — ClerkProvider throws
  // when the publishable key is missing.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return page;

  return <ClerkProvider>{page}</ClerkProvider>;
}
