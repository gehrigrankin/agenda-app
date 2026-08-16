import "server-only";

import { createHash } from "node:crypto";

/** Stable, non-identifying browser-cache namespace for one app owner. */
export function cacheScopeForOwner(ownerId: string | null): string {
  if (!ownerId) return "anonymous";
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 20);
}
