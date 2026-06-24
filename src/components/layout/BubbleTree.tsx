"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, CircleDashed } from "lucide-react";

export interface SidebarBubble {
  id: string;
  parentId: string | null;
  title: string;
  emoji?: string | null;
}

/**
 * Collapsible folder-like tree of the bubble map, shown under the "Bubble map"
 * sidebar link. Each node links to /app/bubbles?b=<id>; nodes with children
 * expand/collapse. Read-only navigation — editing happens on the bubble canvas.
 */
export function BubbleTree({
  bubbles,
  onNavigate,
}: {
  bubbles: SidebarBubble[];
  onNavigate?: () => void;
}) {
  const childrenOf = useMemo(() => {
    const map = new Map<string, SidebarBubble[]>();
    for (const b of bubbles) {
      if (b.parentId) {
        const arr = map.get(b.parentId) ?? [];
        arr.push(b);
        map.set(b.parentId, arr);
      }
    }
    return map;
  }, [bubbles]);

  const roots = useMemo(
    () => bubbles.filter((b) => b.parentId === null),
    [bubbles],
  );

  // Show the root's children as the top level (the root is the map itself).
  const topLevel = roots.flatMap((r) => childrenOf.get(r.id) ?? []);

  if (topLevel.length === 0) {
    return (
      <div className="px-2 py-1 text-xs italic text-neutral-400">
        No bubbles yet
      </div>
    );
  }

  return (
    <ul>
      {topLevel.map((b) => (
        <BubbleNode
          key={b.id}
          bubble={b}
          childrenOf={childrenOf}
          depth={0}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function BubbleNode({
  bubble,
  childrenOf,
  depth,
  onNavigate,
}: {
  bubble: SidebarBubble;
  childrenOf: Map<string, SidebarBubble[]>;
  depth: number;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const kids = childrenOf.get(bubble.id) ?? [];
  const hasKids = kids.length > 0;
  const active =
    pathname === "/app/bubbles" && searchParams.get("b") === bubble.id;

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded text-sm ${
          active
            ? "bg-neutral-200/70 dark:bg-neutral-800"
            : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
        }`}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
          className={`rounded p-0.5 text-neutral-400 ${hasKids ? "" : "invisible"}`}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
        <Link
          href={`/app/bubbles?b=${bubble.id}`}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-neutral-700 dark:text-neutral-300"
        >
          {bubble.emoji ? (
            <span className="text-xs">{bubble.emoji}</span>
          ) : (
            <CircleDashed className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          )}
          <span className="truncate">{bubble.title || "Untitled"}</span>
        </Link>
      </div>
      {open && hasKids && (
        <ul>
          {kids.map((k) => (
            <BubbleNode
              key={k.id}
              bubble={k}
              childrenOf={childrenOf}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
