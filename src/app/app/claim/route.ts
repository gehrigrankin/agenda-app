import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GUEST_COOKIE, parseGuestOwnerId } from "@/lib/guest";
import { claimGuestWorkspace } from "@/server/guest";

/**
 * Where a guest's work follows them into a real account.
 *
 * The app shell sends any signed-in request still carrying a guest cookie here
 * (a Route Handler, so no layout wraps it and there is no redirect loop). It
 * re-owns the guest's rows, drops the cookie, and bounces back into the app.
 *
 * The cookie is only cleared on a decisive outcome. If the claim fails — DB
 * down, or a half-finished rewrite — the cookie stays and the next request
 * tries again, because the alternative is stranding rows nobody can reach.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const back = NextResponse.redirect(new URL("/app", req.url));

  const jar = await cookies();
  const guestOwnerId = parseGuestOwnerId(jar.get(GUEST_COOKIE)?.value);
  if (!guestOwnerId) return back;

  const { userId } = await auth();
  // Not signed in: nothing to claim, and the cookie is still their workspace.
  if (!userId) return back;

  try {
    const result = await claimGuestWorkspace(guestOwnerId, userId);
    if (result.status === "target-not-empty") {
      // Their account already holds data, so the guest rows were left alone
      // rather than risking a merge across the owner-unique indexes. Clearing
      // the cookie is still right: they are signed in now, and that workspace
      // is no longer reachable from the UI.
      console.warn(
        "[guest] declined to merge guest workspace into a non-empty account",
      );
    }
    back.cookies.delete(GUEST_COOKIE);
  } catch (err) {
    console.error("[guest] claim failed, keeping cookie for retry:", err);
  }

  return back;
}
