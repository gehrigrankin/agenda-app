"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import type {
  PersonDetailResult,
  PersonGroupItem,
  PersonListItem,
} from "@/app/app/people/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  PHONE_ICON_BTN,
  PhoneNavRow,
  PhoneTitle,
} from "@/components/phone/PhoneScreen";
import { openNavDrawer } from "@/lib/nav-drawer";

import {
  FollowUpsCard,
  AboutCard,
  MentionsCard,
  NextUpCard,
  type PersonPageProps,
} from "./PersonPage";
import { PeopleSidebar, type ActiveGroup } from "./PeopleSidebar";
import {
  ContactAvatar,
  NewPersonInput,
  formatTalkedDate,
} from "./people-shared";

/**
 * Phone People (design §6m–6n): the list is the first screen (reached from
 * More) — group chips above the people, search and add in the header. Tapping
 * someone opens a full-screen person page (`?person=`): avatar, name, quick
 * actions (Email / Call / Schedule), then the same cards as the desktop page
 * (Next up, Notes mentioning, About, Follow-ups). Presentational — all state
 * lives in PeoplePageClient.
 */

export interface PeoplePhoneProps extends Omit<
  PersonPageProps,
  "notices" | "empty" | "loading" | "detail"
> {
  // list
  people: PersonListItem[] | null;
  selectedId: string | null;
  groups: PersonGroupItem[];
  membersByGroup: Map<string, Set<string>>;
  activeGroup: ActiveGroup;
  onActiveGroup: (g: ActiveGroup) => void;
  query: string;
  onQuery: (q: string) => void;
  onCreatePerson: (name: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onImport: () => void;
  onRescan: () => void;
  refreshing: boolean;
  notices: React.ReactNode;
  // navigation
  openId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  // person page data (for the open person)
  detail: PersonDetailResult | null;
  detailLoading: boolean;
}

export function PeoplePhone(props: PeoplePhoneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas md:hidden">
      {props.openId ? <PersonScreen {...props} /> : <ListScreen {...props} />}
    </div>
  );
}

function Pulse({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-panel/90 ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function ListScreen(props: PeoplePhoneProps) {
  const { people, query, onQuery } = props;
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const empty = people !== null && people.length === 0;

  return (
    <>
      <PhoneNavRow
        backLabel="More"
        onBack={openNavDrawer}
        trailing={
          <>
            <button
              type="button"
              aria-label="Search people"
              aria-pressed={searchOpen}
              onClick={() => {
                setSearchOpen((v) => !v);
                onQuery("");
              }}
              className={`${PHONE_ICON_BTN} ${searchOpen ? "bg-white/8 text-sage" : ""}`}
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Add person"
              aria-pressed={addOpen}
              onClick={() => setAddOpen((v) => !v)}
              className={`${PHONE_ICON_BTN} text-sage ${addOpen ? "bg-white/8" : ""}`}
            >
              <UserPlus className="h-5 w-5" />
            </button>
          </>
        }
      />
      <PhoneTitle title="People" />
      {props.notices}
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Users className="h-9 w-9 text-ink-700" />
          <p className="text-[1rem] font-medium text-ink-300">No people yet</p>
          <p className="max-w-sm text-[0.8125rem] text-ink-500">
            Add a contact — then every note that mentions their name builds
            their timeline automatically.
          </p>
          <div className="mt-1 w-full max-w-xs">
            <NewPersonInput onCreate={props.onCreatePerson} />
          </div>
          <button
            type="button"
            onClick={props.onImport}
            className="flex h-11 items-center px-3 text-[0.875rem] text-ink-400"
          >
            Import phone contacts
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pb-20">
          <PeopleSidebar
            people={people}
            today={props.today}
            selectedId={null}
            onSelect={props.onOpen}
            groups={props.groups}
            membersByGroup={props.membersByGroup}
            activeGroup={props.activeGroup}
            onActiveGroup={props.onActiveGroup}
            query={query}
            onQuery={onQuery}
            addOpen={addOpen}
            onAddDone={() => setAddOpen(false)}
            searchOpen={searchOpen}
            onCreatePerson={props.onCreatePerson}
            onCreateGroup={props.onCreateGroup}
            onRenameGroup={props.onRenameGroup}
            onDeleteGroup={props.onDeleteGroup}
            onImport={props.onImport}
            onRescan={props.onRescan}
            refreshing={props.refreshing}
            tablet
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// person
// ---------------------------------------------------------------------------

const ACTION =
  "flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-white/8 bg-panel text-[0.8125rem] text-ink-200 outline-none active:bg-white/8 focus-visible:ring-1 focus-visible:ring-sage/60";
const ACTION_OFF = "pointer-events-none opacity-40";

function PersonScreen(props: PeoplePhoneProps) {
  const { openId, detail, detailLoading, today, groups } = props;
  const ready =
    detail && detail.id === openId && !detailLoading ? detail : null;
  const listed = props.people?.find((p) => p.id === openId);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const subline = ready
    ? [
        ...groups
          .filter((g) => props.memberGroupIds.has(g.id))
          .map((g) => g.name),
        `${ready.mentionCount} mention${ready.mentionCount === 1 ? "" : "s"}`,
        ready.lastMentionedAt
          ? `last seen ${formatTalkedDate(ready.lastMentionedAt, today)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const who = ready ?? listed;

  return (
    <>
      <PhoneNavRow
        backLabel="People"
        onBack={props.onBack}
        trailing={
          <button
            type="button"
            aria-label="Person actions"
            disabled={!ready}
            onClick={() => {
              setConfirm(false);
              setSheet(true);
            }}
            className={PHONE_ICON_BTN}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-24">
        <PhoneTitle
          title={who?.name ?? "Person"}
          subtitle={ready ? subline : undefined}
          leading={
            who ? (
              <ContactAvatar person={who} size="h-14 w-14 text-[1.5rem]" />
            ) : undefined
          }
        />
        {props.notices}
        {!ready ? (
          <div className="flex flex-col gap-3 px-4" aria-hidden>
            <Pulse className="h-16 w-full" />
            <Pulse className="h-32 w-full" />
            <Pulse className="h-32 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 px-4 pb-3">
              <a
                href={ready.email ? `mailto:${ready.email}` : undefined}
                aria-label={ready.email ? `Email ${ready.name}` : "No email"}
                aria-disabled={!ready.email}
                className={`${ACTION} ${ready.email ? "" : ACTION_OFF}`}
              >
                <Mail className="h-5 w-5 text-ink-300" />
                Email
              </a>
              <a
                href={ready.phone ? `tel:${ready.phone}` : undefined}
                aria-label={ready.phone ? `Call ${ready.name}` : "No phone"}
                aria-disabled={!ready.phone}
                className={`${ACTION} ${ready.phone ? "" : ACTION_OFF}`}
              >
                <Phone className="h-5 w-5 text-ink-300" />
                Call
              </a>
              <Link href="/app/calendar" className={ACTION}>
                <CalendarPlus className="h-5 w-5 text-ink-300" />
                Schedule
              </Link>
            </div>
            <div className="flex flex-col gap-3 px-4">
              <NextUpCard
                events={props.upcoming}
                today={today}
                name={ready.name}
              />
              <MentionsCard
                detail={ready}
                today={today}
                onOpen={props.onOpenMention}
              />
              <AboutCard
                detail={ready}
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
              <FollowUpsCard
                detail={ready}
                onToggle={props.onToggleCommitment}
                onDelete={props.onDeleteCommitment}
                onAdd={props.onAddCommitment}
              />
            </div>
          </>
        )}
      </div>

      {sheet && ready && (
        <BottomSheet
          label="Person actions"
          header={
            <p className="truncate px-5 pb-2 text-[0.8125rem] text-ink-500">
              {ready.name}
            </p>
          }
          onClose={() => setSheet(false)}
        >
          <div className="pb-2">
            <button
              type="button"
              aria-pressed={ready.isFavorite}
              onClick={() => {
                props.onToggleFavorite();
                setSheet(false);
              }}
              className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] text-ink-100 active:bg-white/5"
            >
              <Star
                className={`h-5 w-5 ${ready.isFavorite ? "fill-area-amber text-area-amber" : "text-ink-400"}`}
              />
              {ready.isFavorite ? "Remove from close" : "Add to close"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                setSheet(false);
                props.onDelete();
              }}
              className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] text-area-coral active:bg-white/5"
            >
              <Trash2 className="h-5 w-5" />
              {confirm ? "Tap again to remove contact" : "Remove contact"}
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
