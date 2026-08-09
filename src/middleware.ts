import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { GUEST_COOKIE, parseGuestOwnerId } from "@/lib/guest";

// Everything under /app requires an owner. Auth routes are public.
const isProtectedRoute = createRouteMatcher(["/app(.*)"]);

// Same graceful degradation as the DB and the root layout: with no Clerk key
// configured, clerkMiddleware throws on every request — fall back to a no-op
// so the public pages still serve. (Guest mode still works in that state; only
// real sign-in needs Clerk keys.)
export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware(async (auth, req) => {
      if (!isProtectedRoute(req)) return;
      // A guest cookie is a legitimate way to be inside /app, so check it
      // before auth.protect(), which would redirect the guest to sign-in.
      // Only the shape is validated here; whether the workspace exists is the
      // DB's problem, and a bogus cookie just yields an empty one.
      if (parseGuestOwnerId(req.cookies.get(GUEST_COOKIE)?.value)) return;
      await auth.protect();
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
