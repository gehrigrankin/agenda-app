"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownUp,
  ChevronDown,
  Clock,
  Globe,
  Inbox as InboxIcon,
  Mail,
  Mic,
  Share2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { InboxItemResult } from "@/app/app/inbox/actions";
import {
  SIDEBAR_FOCUS,
  SidebarIconButton,
  SidebarRow,
  SidebarSection,
} from "@/components/layout/sidebar";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { domainOf, receivedLabel, type InboxView } from "@/lib/inbox-triage";

import { SOURCE_META } from "./inbox-shared";

/**
 * The Inbox's sidebars (Notes Sidebars design §5f / §6f): sidebar 1 lists the
 * sources and the DONE views with counts; sidebar 2 is the triage queue. On
 * tablets the sources collapse into a dropdown at the top of the queue, which
 * then stands alone as sidebar 1.
 */

export const VIEW_META: Record<
  InboxView,
  { label: string; icon: LucideIcon; queueLabel: string; empty: string }
> = {
  all: {
    label: "All",
    icon: InboxIcon,
    queueLabel: "to triage",
    empty: "Inbox zero",
  },
  email: {
    label: "Email",
    icon: Mail,
    queueLabel: "to triage",
    empty: "No email waiting",
  },
  voice: {
    label: "Voice",
    icon: Mic,
    queueLabel: "to triage",
    empty: "No voice memos waiting",
  },
  clips: {
    label: "Web clips",
    icon: Globe,
    queueLabel: "to triage",
    empty: "No web clips waiting",
  },
  shared: {
    label: "Shared",
    icon: Share2,
    queueLabel: "to triage",
    empty: "Nothing shared waiting",
  },
  filed: {
    label: "Filed today",
    icon: Archive,
    queueLabel: "filed today",
    empty: "Nothing filed yet today",
  },
  snoozed: {
    label: "Snoozed",
    icon: Clock,
    queueLabel: "snoozed",
    empty: "Nothing snoozed",
  },
};

const SOURCE_VIEWS: InboxView[] = ["all", "email", "voice", "clips", "shared"];
const DONE_VIEWS: InboxView[] = ["filed", "snoozed"];

export type ViewCounts = Record<InboxView, number>;

/** Sidebar 1 body: sources, then DONE. */
export function InboxSourcesSidebar({
  view,
  counts,
  onView,
}: {
  view: InboxView;
  counts: ViewCounts;
  onView: (v: InboxView) => void;
}) {
  const row = (v: InboxView) => (
    <SidebarRow
      key={v}
      icon={VIEW_META[v].icon}
      label={VIEW_META[v].label}
      count={counts[v]}
      active={view === v}
      onClick={() => onView(v)}
    />
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="py-1">{SOURCE_VIEWS.map(row)}</div>
      <div className="border-t border-white/6">
        <SidebarSection label="Done" storageKey="inbox.done">
          {DONE_VIEWS.map(row)}
        </SidebarSection>
      </div>
    </div>
  );
}

/** "N TO TRIAGE" + the newest/oldest sort toggle (the queue's header). */
export function QueueHeader({
  count,
  view,
  sort,
  onSort,
  tablet,
  counts,
  onView,
}: {
  count: number;
  view: InboxView;
  sort: "newest" | "oldest";
  onSort: () => void;
  tablet: boolean;
  counts: ViewCounts;
  onView: (v: InboxView) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 pl-2">
      {tablet ? (
        <ViewDropdown view={view} counts={counts} onView={onView} />
      ) : (
        <h2 className="min-w-0 flex-1 truncate pl-2 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-400 uppercase">
          {count} {VIEW_META[view].queueLabel}
        </h2>
      )}
      {tablet && (
        <span className="min-w-0 flex-1 truncate text-right text-[0.8125rem] text-ink-600">
          {count} {VIEW_META[view].queueLabel}
        </span>
      )}
      <SidebarIconButton
        icon={ArrowDownUp}
        label={
          sort === "newest"
            ? "Sorted newest first — show oldest first"
            : "Sorted oldest first — show newest first"
        }
        onClick={onSort}
      />
    </div>
  );
}

function ViewDropdown({
  view,
  counts,
  onView,
}: {
  view: InboxView;
  counts: ViewCounts;
  onView: (v: InboxView) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  const label = view === "all" ? "All sources" : VIEW_META[view].label;
  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center gap-1.5 rounded-lg bg-white/6 pr-2 pl-3 text-[0.875rem] font-medium text-ink-100 hover:bg-white/10 touch:h-11 ${SIDEBAR_FOCUS}`}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1 w-56 rounded-lg border border-white/8 bg-card py-1 shadow-xl"
        >
          {[...SOURCE_VIEWS, ...DONE_VIEWS].map((v, i) => {
            const Icon = VIEW_META[v].icon;
            return (
              <div key={v}>
                {i === SOURCE_VIEWS.length && (
                  <div className="my-1 border-t border-white/6" />
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === v}
                  onClick={() => {
                    setOpen(false);
                    onView(v);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[0.875rem] hover:bg-white/6 touch:min-h-11 ${
                    view === v ? "text-sage" : "text-ink-300"
                  }`}
                >
                  <Icon className="h-4 w-4 flex-none" />
                  <span className="flex-1">
                    {v === "all" ? "All sources" : VIEW_META[v].label}
                  </span>
                  <span className="text-[0.75rem] text-ink-600 tabular-nums">
                    {counts[v]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One queue row: source icon, title, sender/time line, a 2-line excerpt. */
function QueueRow({
  item,
  now,
  active,
  onSelect,
}: {
  item: InboxItemResult;
  now: Date;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const { Icon, long } = SOURCE_META[item.source];
  const domain = domainOf(item.url);
  const sub =
    item.source === "link" && domain
      ? `${domain} · ${receivedLabel(item.receivedAt, now)}`
      : `${long} · ${receivedLabel(item.receivedAt, now)}`;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`relative flex w-full items-start gap-3 border-b border-white/6 py-2.5 pr-3 pl-4 text-left transition-colors touch:min-h-[3.4rem] ${SIDEBAR_FOCUS} ${
        active ? "bg-sage/13" : "hover:bg-white/4"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px] bg-sage"
        />
      )}
      <Icon
        className={`mt-0.5 h-4 w-4 flex-none ${active ? "text-sage" : "text-ink-500"}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] leading-tight font-medium text-ink-100">
          {item.title}
        </span>
        <span className="truncate text-[0.8125rem] leading-tight text-ink-500">
          {sub}
          {item.isSample && " · sample"}
        </span>
        {item.excerpt && (
          <span className="line-clamp-2 text-[0.8125rem] leading-snug text-ink-400">
            {item.excerpt}
          </span>
        )}
      </span>
    </button>
  );
}

export function QueueList({
  items,
  now,
  selectedId,
  onSelect,
  empty,
}: {
  items: InboxItemResult[] | null;
  now: Date | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (items === null || now === null) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[0.8125rem] text-ink-600">
        {empty}
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" role="list">
      {items.map((item) => (
        <div role="listitem" key={item.id}>
          <QueueRow
            item={item}
            now={now}
            active={item.id === selectedId}
            onSelect={() => onSelect(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
