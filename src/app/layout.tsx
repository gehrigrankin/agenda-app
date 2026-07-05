import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";

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
      <html lang="en">
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
