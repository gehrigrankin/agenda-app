"use client";

import { useEffect, useState } from "react";
import {
  Globe,
  Image as ImageIcon,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  listFolderBubblesAction,
  type FolderBubbleOption,
  type InboxItemResult,
} from "@/app/app/inbox/actions";

/** Icon and wording per capture source, shared by the phone and desktop trees. */
export const SOURCE_META: Record<
  InboxItemResult["source"],
  { Icon: LucideIcon; label: string; long: string }
> = {
  email: { Icon: Mail, label: "email", long: "Email" },
  link: { Icon: Globe, label: "link", long: "Web clip" },
  photo: { Icon: ImageIcon, label: "photo", long: "Shared photo" },
  text: { Icon: MessageSquare, label: "text", long: "Shared text" },
  voice: { Icon: Mic, label: "voice", long: "Voice memo" },
};

// ---------------------------------------------------------------------------
// "Somewhere else" folder picker
// ---------------------------------------------------------------------------

export function SomewhereElsePicker({
  onPick,
  className = "absolute left-0 top-full z-40 mt-1 w-56",
}: {
  /** `null` = "just file it — no folder". */
  onPick: (folder: FolderBubbleOption | null) => void;
  className?: string;
}) {
  const [folders, setFolders] = useState<FolderBubbleOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFolderBubblesAction()
      .then((rows) => {
        if (!cancelled) setFolders(rows);
      })
      .catch((err) => {
        console.error("[inbox] load folders failed:", err);
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rowCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.8125rem] text-ink-300 hover:bg-white/6 touch:min-h-11";
  return (
    <div
      role="menu"
      className={`max-h-72 overflow-y-auto rounded-lg border border-white/8 bg-card py-1 shadow-xl ${className}`}
    >
      {folders === null ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-600" />
        </div>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick(null)}
            className={rowCls}
          >
            Just file it — no folder
          </button>
          {folders.length === 0 ? (
            <div className="px-3 py-2 text-[0.75rem] italic text-ink-600">
              No folders yet — mark a bubble as a folder in Canvas.
            </div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() => onPick(f)}
                className={rowCls}
              >
                {f.emoji ? (
                  <span className="w-3.5 flex-none text-center text-[0.75rem] leading-none">
                    {f.emoji}
                  </span>
                ) : (
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: f.color ?? "#5c6360" }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}
