import { describe, expect, it } from "vitest";

import { isGuestOwner, newGuestOwnerId, parseGuestOwnerId } from "./guest";

describe("newGuestOwnerId", () => {
  it("mints a parseable, guest-prefixed id", () => {
    const id = newGuestOwnerId();
    expect(isGuestOwner(id)).toBe(true);
    expect(parseGuestOwnerId(id)).toBe(id);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 100 }, newGuestOwnerId));
    expect(ids.size).toBe(100);
  });
});

describe("isGuestOwner", () => {
  it("rejects Clerk ids and empty owners", () => {
    expect(isGuestOwner("user_2abcDEF")).toBe(false);
    expect(isGuestOwner(null)).toBe(false);
    expect(isGuestOwner(undefined)).toBe(false);
    expect(isGuestOwner("")).toBe(false);
  });
});

describe("parseGuestOwnerId", () => {
  it("accepts a well-formed id", () => {
    const id = "guest_2f4a1b6c-8d0e-4f21-9a3b-5c6d7e8f9a0b";
    expect(parseGuestOwnerId(id)).toBe(id);
  });

  it("rejects anything a forged cookie could carry", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "guest_",
      "guest_not-a-uuid",
      // Right shape, wrong prefix — must never stand in for a Clerk owner.
      "user_2f4a1b6c-8d0e-4f21-9a3b-5c6d7e8f9a0b",
      // Uppercase hex: we only ever mint lowercase, so treat it as foreign.
      "guest_2F4A1B6C-8D0E-4F21-9A3B-5C6D7E8F9A0B",
      // Trailing junk, e.g. an attempt at SQL or path smuggling.
      "guest_2f4a1b6c-8d0e-4f21-9a3b-5c6d7e8f9a0b'",
      "guest_2f4a1b6c-8d0e-4f21-9a3b-5c6d7e8f9a0b extra",
      " guest_2f4a1b6c-8d0e-4f21-9a3b-5c6d7e8f9a0b",
    ]) {
      expect(parseGuestOwnerId(bad)).toBeNull();
    }
  });
});
