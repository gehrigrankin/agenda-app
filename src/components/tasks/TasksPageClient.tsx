"use client";

import { useEffect, useState } from "react";

import { TasksDesktop } from "@/components/tasks/desktop/TasksDesktop";
import { TasksPhone } from "@/components/tasks/TasksPhone";

/**
 * The Tasks page picks its tree by width: md+ (desktop and tablet) gets the
 * Notes Sidebars layout (`TasksDesktop`: lists sidebar, list, details
 * sidebar); the phone keeps its own flow (`TasksPhone`). Mounting only one
 * keeps the two from loading the same data twice. Until the width is known
 * (SSR, first paint) neither renders — both load client-side anyway.
 */
function useIsWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

export function TasksPageClient({ cacheScope }: { cacheScope: string }) {
  const wide = useIsWide();
  if (wide === null) return <div className="h-full bg-canvas" />;
  return wide ? (
    <TasksDesktop cacheScope={cacheScope} />
  ) : (
    <TasksPhone cacheScope={cacheScope} />
  );
}
