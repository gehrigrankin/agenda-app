"use client";

import { createContext, useContext } from "react";

/**
 * Marks an editor as the daily-note surface. Plugins change behavior on it:
 * TimestampPlugin stamps new blocks, and NoteLinkPlugin inserts block-level
 * linked-note cards instead of inline chips.
 */
export const DailyEditorContext = createContext<{ isDaily: boolean }>({
  isDaily: false,
});

export function useDailyEditor() {
  return useContext(DailyEditorContext);
}
