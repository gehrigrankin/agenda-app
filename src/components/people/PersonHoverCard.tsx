"use client";

import { useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";

import {
  getPersonAction,
  type PersonDetailResult,
} from "@/app/app/people/actions";

/**
 * Reusable hover-peek popover — the "hover any name anywhere to peek it"
 * promise (design 15a). Wrap a name/mention with this and, after a short
 * hover delay, it fetches (once per person, cached module-wide for the
 * session) and shows a compact card: avatar, mention count, owe/owed
 * counts, and the most recent mentions. No navigation required.
 */

const cache = new Map<string, Promise<PersonDetailResult | null>>();

function fetchPerson(personId: string): Promise<PersonDetailResult | null> {
  let pending = cache.get(personId);
  if (!pending) {
    pending = getPersonAction(personId).catch(() => null);
    cache.set(personId, pending);
  }
  return pending;
}

const HOVER_DELAY_MS = 350;

export function PersonHoverCard({
  personId,
  children,
  className,
}: {
  personId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<PersonDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);

  const scheduleOpen = () => {
    timer.current = setTimeout(() => {
      setOpen(true);
      if (!loaded.current) {
        loaded.current = true;
        setLoading(true);
        fetchPerson(personId).then((result) => {
          setPerson(result);
          setLoading(false);
        });
      }
    }, HOVER_DELAY_MS);
  };

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <div
      className={`relative ${className ?? "inline-block"}`}
      onMouseEnter={scheduleOpen}
      onMouseLeave={cancel}
    >
      {children}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-white/10 bg-panel p-3 shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
            </div>
          ) : person ? (
            <PersonPeekBody person={person} />
          ) : (
            <p className="text-[0.75rem] text-ink-600">No page yet</p>
          )}
        </div>
      )}
    </div>
  );
}

function PersonPeekBody({ person }: { person: PersonDetailResult }) {
  const unresolvedYouOwe = person.youOwe.filter((c) => !c.resolvedAt);
  const unresolvedTheyOwe = person.theyOwe.filter((c) => !c.resolvedAt);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sage/15 text-[0.75rem] font-semibold text-sage">
          {person.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink-100">
          {person.name}
        </span>
      </div>
      <p className="mt-1.5 text-[0.65625rem] text-ink-600">
        {person.mentionCount} mention{person.mentionCount === 1 ? "" : "s"}
      </p>

      {(unresolvedYouOwe.length > 0 || unresolvedTheyOwe.length > 0) && (
        <div className="mt-2 flex items-center gap-3 text-[0.65625rem]">
          {unresolvedYouOwe.length > 0 && (
            <span className="flex items-center gap-1 text-[#D9938A]">
              <ArrowUpRight className="h-2.5 w-2.5" />
              {unresolvedYouOwe.length} you owe
            </span>
          )}
          {unresolvedTheyOwe.length > 0 && (
            <span className="flex items-center gap-1 text-sage">
              <ArrowDownLeft className="h-2.5 w-2.5" />
              {unresolvedTheyOwe.length} owed to you
            </span>
          )}
        </div>
      )}

      {person.mentions.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-white/7 pt-2">
          {person.mentions.slice(0, 2).map((m) => (
            <p
              key={m.id}
              className="truncate text-[0.6875rem] text-ink-500"
              title={m.snippet}
            >
              &ldquo;{m.snippet}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
