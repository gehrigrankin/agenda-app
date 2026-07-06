"use client";

import { createContext, useContext } from "react";

/**
 * Marks an editor as the daily-note surface. Plugins change behavior on it:
 * TimestampPlugin stamps new blocks, and NoteLinkPlugin inserts block-level
 * linked-note cards instead of inline chips. `splitLinks` is the daily
 * widget's split view: linked-note cards collapse to inline chips in the doc
 * and render as full cards in the side pane instead.
 */
export const DailyEditorContext = createContext<{
  isDaily: boolean;
  splitLinks?: boolean;
}>({
  isDaily: false,
  splitLinks: false,
});

export function useDailyEditor() {
  return useContext(DailyEditorContext);
}
