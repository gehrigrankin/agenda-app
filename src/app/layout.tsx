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
  // PWA: iOS ignores most of the web manifest, so the apple-touch-icon and
  // the standalone ("add to Home Screen") meta are declared here. The
  // manifest itself (src/app/manifest.ts) is auto-linked by Next.
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Agenda",
  },
};

// viewportFit cover enables env(safe-area-inset-*) on iOS, which the bubble
// canvas controls use to stay clear of the home indicator / Safari toolbar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#141618" },
  ],
};

const themeScript = `(()=>{try{const s=localStorage.getItem("agenda-theme");const d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const page = (
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <head>
        {/* Runs before paint so a saved dark choice never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );

  // Same graceful degradation as the DB: without a Clerk key the app (and
  // `next build`'s static prerender) must still work — ClerkProvider throws
  // when the publishable key is missing.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return page;

  return <ClerkProvider>{page}</ClerkProvider>;
}
