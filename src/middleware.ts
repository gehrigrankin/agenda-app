import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Everything under /app requires auth. Marketing/landing + auth routes are public.
const isProtectedRoute = createRouteMatcher(["/app(.*)"]);

// Same graceful degradation as the DB and the root layout: with no Clerk key
// configured, clerkMiddleware throws on every request — fall back to a no-op
// so the public pages still serve. (/app stays auth-only and needs real keys.)
export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
