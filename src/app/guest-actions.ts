"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  newGuestOwnerId,
  parseGuestOwnerId,
} from "@/lib/guest";
import { touchGuestSession } from "@/server/guest";

/**
 * "Continue as guest" — mints a workspace and drops the visitor into the app.
 *
 * Reuses an existing cookie when there is one so a guest who wanders back to
 * the sign-in page doesn't abandon the notes they already wrote.
 */
export async function continueAsGuest(): Promise<void> {
  const jar = await cookies();
  const ownerId =
    parseGuestOwnerId(jar.get(GUEST_COOKIE)?.value) ?? newGuestOwnerId();

  jar.set(GUEST_COOKIE, ownerId, {
    // The id is the only credential, so keep it away from scripts entirely.
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });

  // Registering the workspace is what makes it purgeable later. A DB outage
  // shouldn't block entry — the app already degrades to empty reads, and the
  // next request re-registers.
  try {
    await touchGuestSession(ownerId);
  } catch (err) {
    console.error("[guest] failed to register guest session:", err);
  }

  redirect("/app");
}

/**
 * Leaves a guest workspace — the guest counterpart of signing out. Only the
 * cookie is dropped; the rows stay put until the retention sweep, so coming
 * back on this browser within the window is a lost cause but signing up on
 * another device isn't a data-loss event we caused.
 */
export async function exitGuest(): Promise<void> {
  (await cookies()).delete(GUEST_COOKIE);
  redirect("/sign-in");
}
