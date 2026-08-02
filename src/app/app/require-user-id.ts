import { auth } from "@clerk/nextjs/server";

/**
 * Shared Clerk auth guard for server actions: every actions.ts file wraps its
 * repo calls in this so `ownerId` is always a real signed-in user. Plain
 * module (no "use server") — "use server" files may only export async
 * actions, not plain helpers.
 */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}
