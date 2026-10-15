"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Hover peek for a note row (Notes Sidebars design §3b): path, title, the
 * first lines, and when it was edited — with the click hints. It never takes
 * focus or pointer events away from the tree; leaving the row dismisses it.
 */
export function NotePeek({
  rect,
  path,
  title,
  preview,
  updatedAt,
}: {
  rect: DOMRect;
  path: string;
  title: string;
  preview: string;
  updatedAt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(rect.top);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(rect.top - 8, window.innerHeight - h - 8)));
  }, [rect]);
  const edited = new Date(updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="animate-pop-in pointer-events-none fixed z-[60] w-[21rem] overflow-hidden rounded-xl border border-white/10 bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
      style={{ left: rect.right + 10, top }}
    >
      <div className="px-4 pt-3 pb-3">
        <p className="truncate text-[0.75rem] text-ink-500">
          {path ? `${path} · ` : ""}edited {edited}
        </p>
        <p className="mt-1 truncate text-[1rem] font-semibold text-ink-100">
          {title || "Untitled"}
        </p>
        <p className="mt-1.5 line-clamp-4 text-[0.84rem] leading-relaxed text-ink-300">
          {preview || "Empty note"}
        </p>
      </div>
      <div className="flex gap-4 border-t border-white/7 px-4 py-2 text-[0.72rem] text-ink-500">
        <span>Click to open</span>
        <span>{isMac ? "⌘" : "Ctrl"}-click new tab</span>
        <span>{isMac ? "⌥" : "Alt"}-click split</span>
      </div>
    </div>
  );
}
