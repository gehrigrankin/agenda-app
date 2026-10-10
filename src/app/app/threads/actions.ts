"use server";

import { requireOwnerId } from "../owner";
import {
  EMPTY_THREAD_CONTEXT,
  getThreadContext,
  type ThreadContext,
} from "@/server/thread-context";

/**
 * Server actions for the Threads page's Context sidebar (people, open tasks,
 * suggested notes). Thin wrapper over `src/server/thread-context.ts`: owner
 * resolved via requireOwnerId, input validated at runtime, and any failure
 * degrades to an empty context rather than breaking the page.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getThreadContextAction(
  threadId: string,
): Promise<ThreadContext> {
  const ownerId = await requireOwnerId();
  if (typeof threadId !== "string" || !UUID_RE.test(threadId)) {
    return EMPTY_THREAD_CONTEXT;
  }
  try {
    return await getThreadContext(ownerId, threadId);
  } catch (err) {
    console.error("[threads] context failed:", err);
    return EMPTY_THREAD_CONTEXT;
  }
}
