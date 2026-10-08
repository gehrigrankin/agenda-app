"use client";

import { useEffect, useMemo } from "react";

import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { useNoteDock } from "@/components/notes/NoteDockProvider";

import { TodayPage } from "./today/TodayPage";

/**
 * Home is the Today page: a school agenda (see today/TodayPage.tsx). This
 * wrapper only wires note-link clicks in the daily note into the app shell's
 * note dock, which survives navigation.
 */
export function HomeClient({
  viewDate,
  cacheScope,
}: {
  viewDate: string | null;
  cacheScope: string;
}) {
  return (
    <NotePreviewProvider>
      <DockBridge>
        <TodayPage viewDate={viewDate} cacheScope={cacheScope} />
      </DockBridge>
    </NotePreviewProvider>
  );
}

function DockBridge({ children }: { children: React.ReactNode }) {
  const invalidatePreview = usePreviewInvalidator();
  const dock = useNoteDock();
  const dockOpen = dock?.open;
  const dockOnClose = dock?.onClose;
  useEffect(() => {
    if (!dockOnClose) return;
    return dockOnClose((id) => invalidatePreview?.(id));
  }, [dockOnClose, invalidatePreview]);
  const quickViewCtx = useMemo(
    () => (dockOpen ? { open: dockOpen } : null),
    [dockOpen],
  );
  return (
    <QuickViewContext.Provider value={quickViewCtx}>
      {children}
    </QuickViewContext.Provider>
  );
}
