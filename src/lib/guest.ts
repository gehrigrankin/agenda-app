/**
 * Guest identity.
 *
 * A signed-out visitor gets the real app, not a demo: every table is already
 * scoped by an opaque `ownerId` string and there is no local users table, so a
 * guest is simply an owner with no Clerk account behind it. Clerk mints
 * `user_…`; we mint `guest_…`, so the two namespaces can never collide and
 * `isGuestOwner` is a reliable test on an id alone.
 *
 * The id IS the credential — whoever holds the cookie is that owner — so it has
 * to be unguessable rather than merely unique. `crypto.randomUUID()` is 122
 * random bits, which is why the cookie carries no additional signature: there
 * is nothing to escalate to (a guest id grants access to its own rows and
 * nothing else) and forging one means guessing a v4 UUID.
 *
 * Pure module on purpose — no `next/headers`, no `server-only`. Middleware runs
 * on the edge and needs these same constants.
 */

/** Name of the httpOnly cookie holding the guest's owner id. */
export const GUEST_COOKIE = "agenda_guest";

/** 30 days. Must stay in step with the purge window in `src/server/guest.ts`. */
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const GUEST_PREFIX = "guest_";

const GUEST_ID_RE =
  /^guest_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Mints a fresh guest owner id. */
export function newGuestOwnerId(): string {
  return `${GUEST_PREFIX}${crypto.randomUUID()}`;
}

/** Whether an already-trusted owner id belongs to a guest rather than a Clerk user. */
export function isGuestOwner(ownerId: string | null | undefined): boolean {
  return typeof ownerId === "string" && ownerId.startsWith(GUEST_PREFIX);
}

/**
 * The trust boundary. Cookie values are attacker-controlled, so only a
 * well-formed guest id is ever allowed to become an `ownerId`; anything else
 * reads as "no guest session".
 */
export function parseGuestOwnerId(
  raw: string | null | undefined,
): string | null {
  return typeof raw === "string" && GUEST_ID_RE.test(raw) ? raw : null;
}
