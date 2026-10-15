"use client";

import { usePersistentState } from "./use-persistent-state";

/**
 * Labs flag for ink blocks (Notes Sidebars design §4a). Off by default: the
 * drawing surface works in any browser, but Pencil pressure/palm rejection
 * vary by platform and "Convert to text" needs the AI key. Existing ink
 * blocks always render; the flag only gates inserting new ones.
 */
export const INK_FLAG_KEY = "agenda.flags.ink";

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function useInkFlag(): [boolean, (on: boolean) => void] {
  return usePersistentState<boolean>(INK_FLAG_KEY, false, isBool);
}
