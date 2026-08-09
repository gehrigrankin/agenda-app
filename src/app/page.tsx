import { redirect } from "next/navigation";

import { getOwnerId } from "@/app/app/owner";

/**
 * The root URL is a doormat, not a destination: anyone who already has a
 * workspace — signed in or carrying a guest cookie — goes straight to today's
 * view, and everyone else goes to sign-in, which is where "continue as guest"
 * lives. There is no landing page to stop at and no "open app" button to press.
 */
export default async function RootPage() {
  redirect((await getOwnerId()) ? "/app" : "/sign-in");
}
