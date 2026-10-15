"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Mail,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";

import type {
  PersonCommitmentItem,
  PersonDetailResult,
  PersonGroupItem,
  PersonMentionItem,
  PersonUpcomingEventItem,
} from "@/app/app/people/actions";
import { SidebarIconButton, SIDEBAR_FOCUS } from "@/components/layout/sidebar";
import { SidebarToggles } from "@/components/layout/PageLayout";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { addDays, formatShortDate } from "@/lib/dates";

import {
  ContactAvatar,
  ContactEditor,
  OweSection,
  formatTalkedDate,
  sourceLabel,
} from "./people-shared";

/**
 * The person page of the desktop/tablet People layout (Notes Sidebars design
 * §5e): a centered header — name, a short subline, mail/call icon buttons —
 * over a 2-column grid of collapsible cards: Next up, About, Notes mentioning,
 * Follow-ups. One column on tablets (the design's 6e).
 */

function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}

// ---------------------------------------------------------------------------
// card chrome
// ---------------------------------------------------------------------------

function PersonCard({
  id,
  title,
  count,
  actions,
  children,
  popovers,
}: {
  id: string;
  title: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** The body hosts dropdowns that must not be clipped by the card. */
  popovers?: boolean;
}) {
  const [open, setOpen] = usePersistentState<boolean>(
    `agenda.section.people.card.${id}`,
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-white/8 bg-panel ${popovers ? "" : "overflow-hidden"}`}
    >
      <div className="flex min-h-[2.75rem] items-center pr-2 touch:min-h-[3.4rem]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex h-full min-h-[2.75rem] min-w-0 flex-1 items-center gap-2 pl-3.5 text-left touch:min-h-[3.4rem] ${SIDEBAR_FOCUS}`}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 flex-none text-ink-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-none text-ink-500" />
          )}
          <span className="min-w-0 truncate text-[0.9375rem] font-semibold text-ink-100">
            {title}
          </span>
          {count !== undefined && count > 0 && (
            <span className="ml-auto pr-1 text-[0.8125rem] text-ink-600 tabular-nums">
              {count}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && <div className="border-t border-white/6">{children}</div>}
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3.5 py-4 text-[0.875rem] text-ink-600">{children}</p>;
}

// ---------------------------------------------------------------------------
// Next up
// ---------------------------------------------------------------------------

export function NextUpCard({
  events,
  today,
  name,
}: {
  events: PersonUpcomingEventItem[] | null;
  today: string | null;
  name: string;
}) {
  const nowMin = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  return (
    <PersonCard id="next-up" title="Next up" count={events?.length}>
      {events === null ? (
        <div className="space-y-2 p-3.5" aria-hidden>
          <div className="h-9 animate-pulse rounded-lg bg-white/5" />
          <div className="h-9 animate-pulse rounded-lg bg-white/5" />
        </div>
      ) : events.length === 0 ? (
        <EmptyLine>
          Nothing in the next 30 days mentions {name}. Put their name in an
          event&rsquo;s title or notes and it shows up here.
        </EmptyLine>
      ) : (
        <ul>
          {events.map((e) => {
            const isToday = e.localDate === today;
            const now =
              isToday &&
              e.startMin !== null &&
              e.startMin <= nowMin &&
              nowMin < (e.endMin ?? e.startMin + 60);
            const when =
              e.startMin === null ? "All day" : formatClock(e.startMin);
            return (
              <li
                key={e.id}
                className="border-b border-white/6 last:border-b-0"
              >
                <Link
                  href={
                    isToday || today === null ? "/app" : `/app?d=${e.localDate}`
                  }
                  className={`flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/4 touch:min-h-[3.4rem] ${SIDEBAR_FOCUS} ${
                    now ? "bg-sage/8" : ""
                  }`}
                >
                  <span className="w-[4.25rem] flex-none font-mono text-[0.8125rem] leading-tight text-ink-400">
                    <span className={isToday ? "text-sage" : undefined}>
                      {isToday
                        ? "Today"
                        : today && e.localDate === addDays(today, 1)
                          ? "Tomorrow"
                          : formatShortDate(e.localDate).replace(/^\w+, /, "")}
                    </span>
                    <br />
                    {when}
                  </span>
                  <span
                    aria-hidden
                    className="h-8 w-[3px] flex-none rounded-full bg-area-amber"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink-100">
                      {e.title}
                    </span>
                    {e.notes && (
                      <span className="block truncate text-[0.8125rem] text-ink-500">
                        {e.notes}
                      </span>
                    )}
                  </span>
                  {now && (
                    <span className="flex-none font-mono text-[0.75rem] font-semibold tracking-wider text-sage">
                      NOW
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PersonCard>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[2.4rem] items-center gap-4 px-3.5 py-1.5">
      <span className="w-14 flex-none text-[0.875rem] text-ink-600">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[0.9375rem] text-ink-100">
        {children}
      </span>
    </div>
  );
}

function AddToGroup({
  groups,
  onAdd,
}: {
  groups: PersonGroupItem[];
  onAdd: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 items-center gap-1 rounded-full border border-dashed border-white/15 px-2.5 text-[0.8125rem] text-ink-400 hover:bg-white/6 hover:text-ink-200 touch:h-11 touch:px-3.5 ${SIDEBAR_FOCUS}`}
      >
        <Plus className="h-3 w-3" /> Group
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1 w-48 rounded-lg border border-white/8 bg-card py-1 shadow-xl"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-[0.8125rem] text-ink-600">
              No groups left to add. Make one with + in the sidebar.
            </p>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onAdd(g.id);
                }}
                className={`flex w-full items-center px-3 py-1.5 text-left text-[0.875rem] text-ink-300 hover:bg-white/6 touch:min-h-11 ${SIDEBAR_FOCUS}`}
              >
                <span className="truncate">{g.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AboutCard({
  detail,
  allGroups,
  memberGroupIds,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onToggleFavorite,
  onAddToGroup,
  onRemoveFromGroup,
}: {
  detail: PersonDetailResult;
  allGroups: PersonGroupItem[];
  memberGroupIds: Set<string>;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (draft: {
    name: string;
    phone: string;
    email: string;
    photoUrl: string | null;
    isFavorite: boolean;
  }) => Promise<void>;
  onToggleFavorite: () => void;
  onAddToGroup: (groupId: string) => void;
  onRemoveFromGroup: (groupId: string) => void;
}) {
  const member = allGroups.filter((g) => memberGroupIds.has(g.id));
  const available = allGroups.filter((g) => !memberGroupIds.has(g.id));
  return (
    <PersonCard
      id="about"
      title="About"
      popovers
      actions={
        <SidebarIconButton
          icon={Pencil}
          label={editing ? "Cancel editing" : "Edit contact"}
          active={editing}
          onClick={editing ? onCancelEdit : onEdit}
        />
      }
    >
      {editing ? (
        <ContactEditor
          person={detail}
          onCancel={onCancelEdit}
          onSave={onSave}
          className="p-3.5"
        />
      ) : (
        <div className="py-1.5">
          <AboutRow label="Email">
            {detail.email ? (
              <a
                href={`mailto:${detail.email}`}
                className="break-all hover:underline"
              >
                {detail.email}
              </a>
            ) : (
              <span className="text-ink-600">Not set</span>
            )}
          </AboutRow>
          <AboutRow label="Phone">
            {detail.phone ? (
              <a href={`tel:${detail.phone}`} className="hover:underline">
                {detail.phone}
              </a>
            ) : (
              <span className="text-ink-600">Not set</span>
            )}
          </AboutRow>
          <AboutRow label="Close">
            <button
              type="button"
              aria-pressed={detail.isFavorite}
              onClick={onToggleFavorite}
              className={`-ml-1 flex h-7 items-center gap-1.5 rounded-md px-1 text-[0.875rem] text-ink-300 hover:bg-white/6 touch:h-11 ${SIDEBAR_FOCUS}`}
            >
              <Star
                className={`h-4 w-4 ${detail.isFavorite ? "fill-area-amber text-area-amber" : "text-ink-600"}`}
              />
              {detail.isFavorite ? "In your close list" : "Add to close"}
            </button>
          </AboutRow>
          <div className="flex items-start gap-4 px-3.5 py-1.5">
            <span className="w-14 flex-none pt-1 text-[0.875rem] text-ink-600">
              Groups
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {member.map((g) => (
                <span
                  key={g.id}
                  className="flex h-7 items-center gap-1 rounded-full bg-white/7 pr-1 pl-2.5 text-[0.8125rem] text-ink-200 touch:h-11 touch:pl-3.5"
                >
                  {g.name}
                  <button
                    type="button"
                    aria-label={`Remove ${detail.name} from ${g.name}`}
                    onClick={() => onRemoveFromGroup(g.id)}
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-ink-500 hover:bg-white/10 hover:text-ink-100 touch:h-9 touch:w-9 ${SIDEBAR_FOCUS}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <AddToGroup groups={available} onAdd={onAddToGroup} />
            </div>
          </div>
        </div>
      )}
    </PersonCard>
  );
}

// ---------------------------------------------------------------------------
// Notes mentioning / Follow-ups
// ---------------------------------------------------------------------------

export function MentionsCard({
  detail,
  today,
  onOpen,
}: {
  detail: PersonDetailResult;
  today: string | null;
  onOpen: (m: PersonMentionItem) => void;
}) {
  return (
    <PersonCard
      id="mentions"
      title={`Notes mentioning ${detail.name}`}
      count={detail.mentions.length}
    >
      {detail.mentions.length === 0 ? (
        <EmptyLine>
          No mentions yet. Write &ldquo;{detail.name}&rdquo; in a note, then
          Rescan.
        </EmptyLine>
      ) : (
        <ul>
          {detail.mentions.map((m) => (
            <li key={m.id} className="border-b border-white/6 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(m)}
                className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-white/4 touch:min-h-[3.4rem] ${SIDEBAR_FOCUS}`}
              >
                <FileText className="mt-0.5 h-4 w-4 flex-none text-ink-500" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink-100">
                      {m.noteDailyDate
                        ? "Daily note"
                        : m.noteTitle || "Untitled"}
                    </span>
                    <span className="flex-none text-[0.8125rem] text-ink-600">
                      {formatTalkedDate(m.mentionDate, today)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-ink-500">
                    &ldquo;{m.snippet}&rdquo;
                  </span>
                  <span className="sr-only">{sourceLabel(m)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PersonCard>
  );
}

export function FollowUpsCard({
  detail,
  onToggle,
  onDelete,
  onAdd,
}: {
  detail: PersonDetailResult;
  onToggle: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: (direction: "you_owe" | "they_owe", text: string) => void;
}) {
  const open = [...detail.youOwe, ...detail.theyOwe].filter(
    (c: PersonCommitmentItem) => !c.resolvedAt,
  ).length;
  return (
    <PersonCard id="follow-ups" title="Follow-ups" count={open}>
      <div className="flex flex-col gap-5 p-3.5">
        <OweSection
          title={`YOU OWE ${detail.name.toUpperCase()}`}
          icon={ArrowUpRight}
          colorClass="text-[#D9938A]"
          items={detail.youOwe}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={(t) => onAdd("you_owe", t)}
        />
        <OweSection
          title={`${detail.name.toUpperCase()} OWES YOU`}
          icon={ArrowDownLeft}
          colorClass="text-sage"
          items={detail.theyOwe}
          onToggle={onToggle}
          onDelete={onDelete}
          onAdd={(t) => onAdd("they_owe", t)}
        />
      </div>
    </PersonCard>
  );
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export function PersonPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[64rem] p-5" aria-hidden>
      <div className="grid gap-4 @[64rem]:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-xl border border-white/6 bg-panel"
          />
        ))}
      </div>
    </div>
  );
}

export interface PersonPageProps {
  detail: PersonDetailResult | null;
  loading: boolean;
  today: string | null;
  upcoming: PersonUpcomingEventItem[] | null;
  groups: PersonGroupItem[];
  memberGroupIds: Set<string>;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onSave: (draft: {
    name: string;
    phone: string;
    email: string;
    photoUrl: string | null;
    isFavorite: boolean;
  }) => Promise<void>;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onAddToGroup: (groupId: string) => void;
  onRemoveFromGroup: (groupId: string) => void;
  onToggleCommitment: (id: string, resolved: boolean) => void;
  onDeleteCommitment: (id: string) => void;
  onAddCommitment: (direction: "you_owe" | "they_owe", text: string) => void;
  onOpenMention: (m: PersonMentionItem) => void;
  /** Rendered above the page header (import / duplicate notices). */
  notices?: React.ReactNode;
  /** Shown when there is nobody to show (no contacts at all). */
  empty?: React.ReactNode;
}

export function PersonPage(props: PersonPageProps) {
  const { detail, loading, today, groups } = props;

  const headerBtn = `flex h-7 w-7 items-center justify-center rounded-md touch:h-11 touch:w-11 ${SIDEBAR_FOCUS}`;
  const iconOn = "text-ink-300 hover:bg-white/6 hover:text-ink-100";
  const iconOff = "pointer-events-none text-ink-700 opacity-50";

  const subline = detail
    ? [
        ...groups
          .filter((g) => props.memberGroupIds.has(g.id))
          .map((g) => g.name),
        `${detail.mentionCount} mention${detail.mentionCount === 1 ? "" : "s"}`,
        detail.lastMentionedAt
          ? `last seen ${formatTalkedDate(detail.lastMentionedAt, today)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <header className="flex min-h-[3.25rem] flex-none items-center gap-3 border-b border-white/6 px-5 py-1.5 touch:min-h-[3.75rem]">
        <SidebarToggles />
        {detail && (
          <>
            <ContactAvatar person={detail} size="h-9 w-9 text-[1rem]" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[1.25rem] leading-tight font-semibold text-ink-100">
                {detail.name}
              </h1>
              <p className="truncate text-[0.8125rem] leading-tight text-ink-500">
                {subline}
              </p>
            </div>
            <div className="flex flex-none items-center gap-0.5">
              <a
                href={detail.email ? `mailto:${detail.email}` : undefined}
                aria-label={detail.email ? `Email ${detail.name}` : "No email"}
                aria-disabled={!detail.email}
                title={detail.email ?? "No email on file"}
                className={`${headerBtn} ${detail.email ? iconOn : iconOff}`}
              >
                <Mail className="h-[1.0625rem] w-[1.0625rem]" />
              </a>
              <a
                href={detail.phone ? `tel:${detail.phone}` : undefined}
                aria-label={detail.phone ? `Call ${detail.name}` : "No phone"}
                aria-disabled={!detail.phone}
                title={detail.phone ?? "No phone on file"}
                className={`${headerBtn} ${detail.phone ? iconOn : iconOff}`}
              >
                <Phone className="h-[1.0625rem] w-[1.0625rem]" />
              </a>
              <button
                type="button"
                aria-label={`Remove ${detail.name}`}
                title="Remove contact"
                onClick={props.onDelete}
                className={`${headerBtn} text-ink-600 hover:bg-white/6 hover:text-[#D9938A]`}
              >
                <Trash2 className="h-[1.0625rem] w-[1.0625rem]" />
              </button>
            </div>
          </>
        )}
      </header>

      {props.notices}

      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {props.empty ? (
          props.empty
        ) : loading || !detail ? (
          <PersonPageSkeleton />
        ) : (
          <div className="mx-auto w-full max-w-[64rem] p-5">
            <div className="grid grid-cols-1 gap-4 @[64rem]:grid-cols-2">
              <NextUpCard
                events={props.upcoming}
                today={today}
                name={detail.name}
              />
              <AboutCard
                detail={detail}
                allGroups={groups}
                memberGroupIds={props.memberGroupIds}
                editing={props.editing}
                onEdit={() => props.setEditing(true)}
                onCancelEdit={() => props.setEditing(false)}
                onSave={props.onSave}
                onToggleFavorite={props.onToggleFavorite}
                onAddToGroup={props.onAddToGroup}
                onRemoveFromGroup={props.onRemoveFromGroup}
              />
              <MentionsCard
                detail={detail}
                today={today}
                onOpen={props.onOpenMention}
              />
              <FollowUpsCard
                detail={detail}
                onToggle={props.onToggleCommitment}
                onDelete={props.onDeleteCommitment}
                onAdd={props.onAddCommitment}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
