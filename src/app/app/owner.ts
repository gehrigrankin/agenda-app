import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { GUEST_COOKIE, parseGuestOwnerId } from "@/lib/guest";

/**
 * Resolves the `ownerId` that every query scopes to. Two kinds of owner reach
 * this point: a signed-in Clerk user (`user_…`) and a guest whose id lives in
 * an httpOnly cookie (`guest_…`). Nothing below this line cares which —
 * `src/server/*` takes an opaque owner string — so the distinction is resolved
 * once, here, and the repo layer stays identity-agnostic.
 *
 * Clerk wins when both are present: a signed-in visitor carrying a leftover
 * guest cookie sees their real account, and `/app/claim` folds the guest rows
 * in and drops the cookie.
 *
 * Keyless mode: `auth()` throws when `clerkMiddleware` never ran, and
 * middleware degrades to a no-op without a publishable key. Skipping the call
 * in that case keeps the same graceful degradation the DB has — and makes
 * guest mode the working path in a Clerk-less dev environment.
 *
 * Plain module (no "use server") — "use server" files may only export async
 * actions, not plain helpers.
 */

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * The guest cookie's owner id, whether or not a Clerk session outranks it.
 * Used to spot a signed-in request that still has a guest workspace to claim.
 */
export async function getGuestCookieOwnerId(): Promise<string | null> {
  const jar = await cookies();
  return parseGuestOwnerId(jar.get(GUEST_COOKIE)?.value);
}

/** The current owner, or null when there is neither a Clerk session nor a guest cookie. */
export async function getOwnerId(): Promise<string | null> {
  if (clerkEnabled) {
    const { userId } = await auth();
    if (userId) return userId;
  }
  return getGuestCookieOwnerId();
}

/**
 * Owner guard for server actions: every actions.ts file wraps its repo calls in
 * this so `ownerId` is always a real owner. Middleware already turns anonymous
 * visitors away from `/app`, so reaching the throw means a stale form post.
 */
export async function requireOwnerId(): Promise<string> {
  const ownerId = await getOwnerId();
  if (!ownerId) throw new Error("Unauthorized");
  return ownerId;
}
