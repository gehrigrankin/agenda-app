"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  ContactRound,
  Import,
  Mail,
  Pencil,
  Phone,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";

import {
  MOBILE_HEADER_ACTION,
  MobilePageHeader,
} from "@/components/layout/MobilePageHeader";
import { PageLayout } from "@/components/layout/PageLayout";

import {
  addCommitmentAction,
  addPersonToGroupAction,
  checkContactDuplicatesAction,
  createPersonAction,
  createPersonGroupAction,
  deleteCommitmentAction,
  deletePersonAction,
  deletePersonGroupAction,
  getPeopleGroupsAction,
  getPersonAction,
  getPersonUpcomingAction,
  importContactAction,
  listPeopleAction,
  refreshPeopleAction,
  removePersonFromGroupAction,
  renamePersonGroupAction,
  setPersonFavoriteAction,
  toggleCommitmentAction,
  updatePersonAction,
  type PersonCommitmentItem,
  type PersonDetailResult,
  type PersonGroupItem,
  type PersonListItem,
  type PersonMentionItem,
  type PersonUpcomingEventItem,
} from "@/app/app/people/actions";
import { PersonHoverCard } from "@/components/people/PersonHoverCard";
import { localDateString } from "@/lib/dates";
import { useTabletLayout } from "@/lib/hooks/use-tablet-layout";

import {
  PeopleSidebar,
  PeopleSidebarActions,
  sortRecent,
  type ActiveGroup,
} from "./PeopleSidebar";
import { PersonPage } from "./PersonPage";
import {
  ContactAvatar,
  ContactEditor,
  NewPersonInput,
  OweSection,
  formatTalkedDate,
  sourceLabel,
} from "./people-shared";

/**
 * People page (design 15a, extended into contacts, made AI-free): every
 * person you mention gets a page. Add contacts by hand; mentions are found by
 * whole-word name matching over your note text, run on visit and on demand
 * via Rescan — no API key involved. That match links every note into the
 * person's timeline (the full passage, not just the title, read like a
 * thread). Owe/owed commitments are entered manually.
 *
 * Layout (Notes Sidebars design §5e): md+ is a PageLayout — sidebar 1 holds
 * the groups and the people list, the content is the person page (cards).
 * Tablets (md–lg, or coarse pointers) fold the groups into filter chips above
 * one list. Below md the original phone UI (list → person) is untouched.
 * All the state lives here and feeds both trees.
 */

// ---------------------------------------------------------------------------
// phone pieces (unchanged phone UI)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// detail pane — mention timeline (thread-like)
// ---------------------------------------------------------------------------

function MentionTimelineRow({
  mention,
  isLast,
  today,
  onOpen,
}: {
  mention: PersonMentionItem;
  isLast: boolean;
  today: string | null;
  onOpen: (mention: PersonMentionItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(mention)}
      className="flex w-full gap-3.5 text-left"
    >
      <span className="flex w-3.5 flex-none flex-col items-center">
        <span className="mt-1 h-2 w-2 flex-none rounded-full bg-steel" />
        {!isLast && <span className="w-[1.5px] flex-1 bg-white/9" />}
      </span>
      <span className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
        <span className="mb-0.5 flex items-center gap-2">
          <span className="text-[0.6875rem] font-medium text-ink-400">
            {formatTalkedDate(mention.mentionDate, today)}
          </span>
          <span className="truncate text-[0.625rem] text-ink-700">
            {sourceLabel(mention)}
          </span>
        </span>
        <span className="block text-[0.78125rem] leading-relaxed text-ink-300">
          &ldquo;{mention.snippet}&rdquo;
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// skeletons
// ---------------------------------------------------------------------------

function PulseBlock({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-panel/90 ${className}`} />
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      <PulseBlock className="h-[3.25rem] w-full" />
      <PulseBlock className="h-[3.25rem] w-full" />
      <PulseBlock className="h-[3.25rem] w-full" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-5">
      <PulseBlock className="mb-4 h-9 w-full" />
      <div className="flex flex-col gap-4">
        <PulseBlock className="h-12 w-full" />
        <PulseBlock className="h-12 w-full" />
        <PulseBlock className="h-12 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// list pane rows
// ---------------------------------------------------------------------------

function PersonListRow({
  person,
  selected,
  onSelect,
  today,
}: {
  person: PersonListItem;
  selected: boolean;
  onSelect: () => void;
  today: string | null;
}) {
  return (
    <PersonHoverCard personId={person.id} className="block w-full">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${
          selected
            ? "border-sage/40 bg-sage/10"
            : "border-transparent hover:bg-white/4"
        }`}
      >
        <ContactAvatar person={person} size="h-8 w-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-medium text-ink-200">
            {person.name}
          </span>
          <span className="block truncate text-[0.6875rem] text-ink-600">
            {person.mentionCount} mention{person.mentionCount === 1 ? "" : "s"}
            {person.lastMentionedAt &&
              ` · last seen ${formatTalkedDate(person.lastMentionedAt, today)}`}
          </span>
        </span>
        {person.isFavorite && (
          <Star className="h-3 w-3 fill-[#D6B36A] text-[#D6B36A]" />
        )}
      </button>
    </PersonHoverCard>
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function PeoplePageClient() {
  const router = useRouter();
  const tablet = useTabletLayout();

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  // `?person=<id>` (the Inbox's "matches a person" chip) opens that person.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("person"),
  );
  const [detail, setDetail] = useState<PersonDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [duplicateQueue, setDuplicateQueue] = useState<
    Array<{
      draft: {
        name: string;
        phone?: string | null;
        email?: string | null;
        photoUrl?: string | null;
      };
      matches: PersonListItem[];
    }>
  >([]);
  const [mobileDetail, setMobileDetail] = useState(false);
  // Bumped after a scan so the open person's timeline reloads.
  const [detailKey, setDetailKey] = useState(0);
  const didInitialScan = useRef(false);

  // Groups (md+ sidebar) and the person page's "Next up".
  const [groups, setGroups] = useState<PersonGroupItem[]>([]);
  const [memberships, setMemberships] = useState<Array<[string, string]>>([]);
  const [activeGroup, setActiveGroup] = useState<ActiveGroup>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [upcoming, setUpcoming] = useState<PersonUpcomingEventItem[] | null>(
    null,
  );

  const reloadPeople = () =>
    listPeopleAction()
      .then(setPeople)
      .catch((err) => console.error("[people] list load failed:", err));

  const reloadGroups = () =>
    getPeopleGroupsAction()
      .then((r) => {
        setGroups(r.groups);
        setMemberships(r.memberships);
      })
      .catch((err) => console.error("[people] groups load failed:", err));

  // Initial load, plus a background name-match sweep so timelines are fresh
  // without the user asking.
  useEffect(() => {
    let cancelled = false;
    listPeopleAction()
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch((err) => console.error("[people] load failed:", err));
    void reloadGroups();

    if (!didInitialScan.current) {
      didInitialScan.current = true;
      refreshPeopleAction()
        .then(() => {
          if (cancelled) return;
          setDetailKey((k) => k + 1);
          return reloadPeople();
        })
        .catch((err) => console.error("[people] background scan failed:", err));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the selection valid as the list changes (initial auto-select: the
  // most recently seen person).
  useEffect(() => {
    if (people === null) return;
    setSelectedId((prev) => {
      if (prev && people.some((p) => p.id === prev)) return prev;
      return sortRecent(people)[0]?.id ?? null;
    });
  }, [people]);

  // Load the selected person's page (re-runs when a scan bumps detailKey).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getPersonAction(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setDetailLoading(false);
      })
      .catch((err) => {
        console.error("[people] detail load failed:", err);
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailKey]);

  // The "Next up" card: upcoming events (next 30 days) that name the person.
  useEffect(() => {
    if (!selectedId) {
      setUpcoming(null);
      return;
    }
    let cancelled = false;
    setUpcoming(null);
    getPersonUpcomingAction(selectedId, localDateString())
      .then((r) => {
        if (!cancelled) setUpcoming(r);
      })
      .catch((err) => {
        console.error("[people] upcoming load failed:", err);
        if (!cancelled) setUpcoming([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailKey]);

  // A different person closes any open editor.
  useEffect(() => {
    setEditing(false);
  }, [selectedId]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of groups) m.set(g.id, new Set());
    for (const [gid, pid] of memberships) m.get(gid)?.add(pid);
    return m;
  }, [groups, memberships]);
  const memberGroupIds = useMemo(
    () =>
      new Set(
        memberships.filter(([, pid]) => pid === selectedId).map(([gid]) => gid),
      ),
    [memberships, selectedId],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPeopleAction();
      await reloadPeople();
      setDetailKey((k) => k + 1);
    } catch (err) {
      console.error("[people] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddCommitment = (
    direction: "you_owe" | "they_owe",
    text: string,
  ) => {
    if (!detail) return;
    const personId = detail.id;
    addCommitmentAction(personId, direction, text)
      .then((created) => {
        if (!created) return;
        setDetail((prev) => {
          if (!prev || prev.id !== personId) return prev;
          const key = direction === "you_owe" ? "youOwe" : "theyOwe";
          // Skip if the dedupe returned an item already shown.
          if (prev[key].some((c) => c.id === created.id)) return prev;
          return { ...prev, [key]: [...prev[key], created] };
        });
      })
      .catch((err) => console.error("[people] add commitment failed:", err));
  };

  const handleDeleteCommitment = (id: string) => {
    const prevDetail = detail;
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            youOwe: prev.youOwe.filter((c) => c.id !== id),
            theyOwe: prev.theyOwe.filter((c) => c.id !== id),
          }
        : prev,
    );
    deleteCommitmentAction(id).catch((err) => {
      console.error("[people] delete commitment failed:", err);
      setDetail(prevDetail);
    });
  };

  const handleCreate = async (name: string) => {
    try {
      const created = await createPersonAction(name);
      if (!created) return;
      await reloadPeople();
      setSelectedId(created.id);
      setDetailKey((k) => k + 1);
    } catch (err) {
      console.error("[people] create failed:", err);
    }
  };

  const handleDelete = (id: string) => {
    const prev = people;
    setPeople((list) => (list ? list.filter((p) => p.id !== id) : list));
    setMemberships((m) => m.filter(([, pid]) => pid !== id));
    if (selectedId === id) setSelectedId(null);
    deletePersonAction(id).catch((err) => {
      console.error("[people] delete failed:", err);
      setPeople(prev);
      void reloadGroups();
    });
  };

  const handleToggleCommitment = (id: string, resolved: boolean) => {
    const prevDetail = detail;
    setDetail((prev) => {
      if (!prev) return prev;
      const patch = (c: PersonCommitmentItem) =>
        c.id === id
          ? { ...c, resolvedAt: resolved ? new Date().toISOString() : null }
          : c;
      return {
        ...prev,
        youOwe: prev.youOwe.map(patch),
        theyOwe: prev.theyOwe.map(patch),
      };
    });
    toggleCommitmentAction(id, resolved).catch((err) => {
      console.error("[people] toggle commitment failed:", err);
      setDetail(prevDetail);
    });
  };

  const goToMention = (mention: PersonMentionItem) => {
    if (mention.noteDailyDate) {
      router.push(`/app?d=${mention.noteDailyDate}`);
    } else {
      router.push(`/app/notes/${mention.noteId}`);
    }
  };

  const saveContact = async (draft: {
    name: string;
    phone?: string | null;
    email?: string | null;
    photoUrl?: string | null;
    isFavorite?: boolean;
  }) => {
    if (!detail) return;
    await updatePersonAction(detail.id, draft);
    setEditing(false);
    await reloadPeople();
    setDetailKey((k) => k + 1);
  };

  // --- groups ---------------------------------------------------------------

  const handleCreateGroup = async (name: string) => {
    try {
      const g = await createPersonGroupAction(name);
      if (!g) return;
      setGroups((prev) => [...prev, g]);
    } catch (err) {
      console.error("[people] create group failed:", err);
    }
  };

  const handleRenameGroup = (id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    renamePersonGroupAction(id, name).catch((err) => {
      console.error("[people] rename group failed:", err);
      void reloadGroups();
    });
  };

  const handleDeleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setMemberships((prev) => prev.filter(([gid]) => gid !== id));
    setActiveGroup((prev) => (prev === id ? null : prev));
    deletePersonGroupAction(id).catch((err) => {
      console.error("[people] delete group failed:", err);
      void reloadGroups();
    });
  };

  const handleAddToGroup = (groupId: string) => {
    if (!selectedId) return;
    const personId = selectedId;
    setMemberships((prev) =>
      prev.some(([g, p]) => g === groupId && p === personId)
        ? prev
        : [...prev, [groupId, personId]],
    );
    addPersonToGroupAction(groupId, personId).catch((err) => {
      console.error("[people] add to group failed:", err);
      void reloadGroups();
    });
  };

  const handleRemoveFromGroup = (groupId: string) => {
    if (!selectedId) return;
    const personId = selectedId;
    setMemberships((prev) =>
      prev.filter(([g, p]) => !(g === groupId && p === personId)),
    );
    removePersonFromGroupAction(groupId, personId).catch((err) => {
      console.error("[people] remove from group failed:", err);
      void reloadGroups();
    });
  };

  const handleToggleFavorite = () => {
    if (!detail) return;
    const id = detail.id;
    const next = !detail.isFavorite;
    setDetail((prev) =>
      prev && prev.id === id ? { ...prev, isFavorite: next } : prev,
    );
    setPeople((list) =>
      list
        ? list.map((p) => (p.id === id ? { ...p, isFavorite: next } : p))
        : list,
    );
    setPersonFavoriteAction(id, next).catch((err) => {
      console.error("[people] favorite failed:", err);
      void reloadPeople();
      setDetailKey((k) => k + 1);
    });
  };

  const choosePhoneContacts = async () => {
    setImportNotice(null);
    const contacts = (
      navigator as Navigator & {
        contacts?: {
          getProperties?: () => Promise<string[]>;
          select: (
            fields: string[],
            options: { multiple: boolean },
          ) => Promise<
            Array<{
              name?: string[];
              tel?: string[];
              email?: string[];
              icon?: Blob[];
            }>
          >;
        };
      }
    ).contacts;
    if (!contacts?.select) {
      setImportNotice(
        "Phone contact import is available in supported Android browsers. You can still add and edit contacts here.",
      );
      return;
    }
    try {
      const available = contacts.getProperties
        ? await contacts.getProperties()
        : ["name", "tel", "email"];
      const fields = ["name", "tel", "email", "icon"].filter((field) =>
        available.includes(field),
      );
      if (!fields.includes("name")) fields.unshift("name");
      const chosen = await contacts.select(fields, { multiple: true });
      const duplicateReviews: typeof duplicateQueue = [];
      for (const item of chosen) {
        const name = item.name?.[0]?.trim();
        if (!name) continue;
        let photoUrl: string | null = null;
        const icon = item.icon?.[0];
        if (icon && icon.size <= 500_000)
          photoUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(icon);
          });
        const draft = {
          name,
          phone: item.tel?.[0] ?? null,
          email: item.email?.[0] ?? null,
          photoUrl,
        };
        const matches = await checkContactDuplicatesAction(draft);
        if (matches.length) {
          duplicateReviews.push({ draft, matches });
          continue;
        }
        const id = await importContactAction(draft);
        if (id) setSelectedId(id);
      }
      await reloadPeople();
      setDetailKey((k) => k + 1);
      if (duplicateReviews.length) {
        setDuplicateQueue(duplicateReviews);
        setImportNotice(
          `${duplicateReviews.length} possible duplicate${duplicateReviews.length === 1 ? " needs" : "s need"} your review.`,
        );
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError")
        setImportNotice(
          "Contacts could not be opened. Check your browser’s contact permission and try again.",
        );
    }
  };

  const loadingShell = people === null;
  const filteredPeople = people?.filter((p) =>
    `${p.name} ${p.phone ?? ""} ${p.email ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const pendingDuplicate = duplicateQueue[0] ?? null;

  const notices = (
    <>
      {importNotice && (
        <div className="flex items-center gap-2 border-b border-white/7 bg-steel/8 px-4 py-2 text-[0.71875rem] text-ink-300">
          <ContactRound className="h-3.5 w-3.5 text-steel" />
          <span className="flex-1">{importNotice}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {pendingDuplicate && (
        <div className="border-b border-[#D6B36A]/20 bg-[#D6B36A]/8 px-4 py-3 text-[0.75rem] text-ink-300">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3">
            <span className="flex-1">
              <strong className="text-ink-100">
                {pendingDuplicate.draft.name}
              </strong>{" "}
              looks like{" "}
              {pendingDuplicate.matches.map((m) => m.name).join(", ")}. Import a
              separate contact?{" "}
              {duplicateQueue.length > 1 && (
                <span className="text-ink-600">
                  ({duplicateQueue.length} to review)
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setDuplicateQueue((q) => q.slice(1))}
              className="rounded-lg px-3 py-1.5 text-ink-500"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                const draft = pendingDuplicate.draft;
                setDuplicateQueue((q) => q.slice(1));
                void importContactAction(draft).then(async (id) => {
                  if (id) {
                    setSelectedId(id);
                    setMobileDetail(true);
                  }
                  await reloadPeople();
                  setDetailKey((k) => k + 1);
                });
              }}
              className="rounded-lg bg-[#D6B36A] px-3 py-1.5 font-semibold text-[#231E16]"
            >
              Import separately
            </button>
          </div>
        </div>
      )}
    </>
  );

  const noPeople = people !== null && people.length === 0;

  return (
    <div className="h-full min-h-0">
      {/* ------------------------------ phone ------------------------------ */}
      <div className="flex h-full min-h-0 flex-col md:hidden">
        <MobilePageHeader
          title="People"
          subtitle={
            loadingShell
              ? "Loading contacts…"
              : `${people.length} contact${people.length === 1 ? "" : "s"}`
          }
          trailing={
            <button
              type="button"
              aria-label="Import phone contacts"
              onClick={() => void choosePhoneContacts()}
              className={MOBILE_HEADER_ACTION}
            >
              <Import className="h-[1.125rem] w-[1.125rem]" />
            </button>
          }
        />
        {notices}
        {loadingShell ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain md:flex-row md:overflow-visible">
            <div className="w-full flex-none border-b border-white/7 md:w-[20rem] md:border-b-0 md:border-r">
              <ListSkeleton />
            </div>
            <div className="min-w-0 flex-1">
              <DetailSkeleton />
            </div>
          </div>
        ) : people && people.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <Users className="h-9 w-9 text-ink-700" />
            <p className="text-[0.84375rem] font-medium text-ink-300">
              No people yet
            </p>
            <p className="max-w-sm text-[0.75rem] text-ink-600">
              Add a contact — then every note that mentions their name builds
              their timeline automatically.
            </p>
            <div className="mt-1 w-full max-w-xs">
              <NewPersonInput onCreate={handleCreate} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-visible">
            {/* List pane */}
            <div
              className={`${mobileDetail ? "hidden" : "flex"} w-full flex-none flex-col gap-2 p-3 md:flex md:w-[21rem] md:overflow-y-auto md:border-r`}
            >
              <NewPersonInput onCreate={handleCreate} />
              <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-input px-3 py-2">
                <Search className="h-3.5 w-3.5 text-ink-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people"
                  className="min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600"
                />
              </label>
              <div className="flex flex-col gap-1">
                {filteredPeople?.map((p) => (
                  <PersonListRow
                    key={p.id}
                    person={p}
                    selected={p.id === selectedId}
                    onSelect={() => {
                      setSelectedId(p.id);
                      setMobileDetail(true);
                    }}
                    today={today}
                  />
                ))}
                {filteredPeople?.length === 0 && (
                  <p className="px-3 py-8 text-center text-[0.75rem] text-ink-600">
                    No contacts match “{query}”.
                  </p>
                )}
              </div>
            </div>

            {/* Detail pane */}
            <div
              className={`${mobileDetail ? "block" : "hidden"} min-w-0 flex-1 md:block md:overflow-y-auto`}
            >
              {detailLoading || !detail ? (
                <DetailSkeleton />
              ) : (
                <>
                  <div className="flex min-h-14 items-center gap-2 border-b border-white/7 px-2 py-2 md:gap-3 md:px-4 md:py-3.5">
                    <button
                      type="button"
                      onClick={() => setMobileDetail(false)}
                      aria-label="Back to people"
                      className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-300 md:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <ContactAvatar person={detail} size="h-11 w-11" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-semibold text-ink-100">
                        {detail.name}
                      </p>
                      <p className="truncate text-[0.6875rem] text-ink-600">
                        {detail.mentionCount} mention
                        {detail.mentionCount === 1 ? "" : "s"}
                        {detail.lastMentionedAt &&
                          ` · last seen ${formatTalkedDate(detail.lastMentionedAt, today)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Edit contact"
                      title="Edit contact"
                      onClick={() => setEditing((v) => !v)}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-white/6 hover:text-ink-200 md:h-[1.875rem] md:w-[1.875rem] md:rounded-lg"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${detail.name}`}
                      title="Remove contact"
                      onClick={() => handleDelete(detail.id)}
                      className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-600 hover:bg-white/6 hover:text-[#D9938A] md:h-[1.625rem] md:w-[1.625rem] md:rounded-md"
                    >
                      <Trash2 className="h-[0.8125rem] w-[0.8125rem]" />
                    </button>
                  </div>

                  {editing && (
                    <ContactEditor
                      person={detail}
                      onCancel={() => setEditing(false)}
                      onSave={saveContact}
                    />
                  )}

                  {(detail.phone || detail.email) && (
                    <div className="flex flex-wrap gap-2 border-b border-white/7 px-5 py-3">
                      {detail.phone && (
                        <a
                          href={`tel:${detail.phone}`}
                          className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-[0.71875rem] text-ink-300"
                        >
                          <Phone className="h-3 w-3 text-sage" />
                          {detail.phone}
                        </a>
                      )}
                      {detail.email && (
                        <a
                          href={`mailto:${detail.email}`}
                          className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-[0.71875rem] text-ink-300"
                        >
                          <Mail className="h-3 w-3 text-steel" />
                          {detail.email}
                        </a>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-5 px-3 py-4 md:p-5">
                    {/* Owe / owed — manual, no AI */}
                    <div className="flex flex-col gap-5 rounded-xl border border-white/8 bg-white/[0.02] p-4 sm:flex-row">
                      <OweSection
                        title={`YOU OWE ${detail.name.toUpperCase()}`}
                        icon={ArrowUpRight}
                        colorClass="text-[#D9938A]"
                        items={detail.youOwe}
                        onToggle={handleToggleCommitment}
                        onDelete={handleDeleteCommitment}
                        onAdd={(t) => handleAddCommitment("you_owe", t)}
                      />
                      <OweSection
                        title={`${detail.name.toUpperCase()} OWES YOU`}
                        icon={ArrowDownLeft}
                        colorClass="text-sage"
                        items={detail.theyOwe}
                        onToggle={handleToggleCommitment}
                        onDelete={handleDeleteCommitment}
                        onAdd={(t) => handleAddCommitment("they_owe", t)}
                      />
                    </div>

                    {/* Mentions timeline — every note, read like a thread */}
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-600">
                          Mentions
                        </span>
                        <span className="text-[0.625rem] text-ink-700">
                          {detail.mentions.length} note
                          {detail.mentions.length === 1 ? "" : "s"} mention{" "}
                          {detail.name}
                        </span>
                      </div>
                      {detail.mentions.length === 0 ? (
                        <p className="text-[0.78125rem] text-ink-600">
                          No mentions yet — write &ldquo;{detail.name}&rdquo; in
                          a note, then Rescan.
                        </p>
                      ) : (
                        <div className="flex flex-col">
                          {detail.mentions.map((m, i) => (
                            <MentionTimelineRow
                              key={m.id}
                              mention={m}
                              isLast={i === detail.mentions.length - 1}
                              today={today}
                              onOpen={goToMention}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------- tablet / desktop ------------------------ */}
      <div className="hidden h-full min-h-0 md:block">
        <PageLayout
          pageKey="people"
          sidebar1={{
            label: "People",
            defaultWidth: 23,
            minWidth: 17,
            maxWidth: 34,
            actions: (
              <PeopleSidebarActions
                addOpen={addOpen}
                searchOpen={searchOpen}
                onToggleAdd={() => setAddOpen((v) => !v)}
                onToggleSearch={() => {
                  setSearchOpen((v) => !v);
                  setQuery("");
                }}
              />
            ),
            children: (
              <PeopleSidebar
                people={people}
                today={today}
                selectedId={selectedId}
                onSelect={setSelectedId}
                groups={groups}
                membersByGroup={membersByGroup}
                activeGroup={activeGroup}
                onActiveGroup={setActiveGroup}
                query={query}
                onQuery={setQuery}
                addOpen={addOpen}
                onAddDone={() => setAddOpen(false)}
                searchOpen={searchOpen}
                onCreatePerson={handleCreate}
                onCreateGroup={handleCreateGroup}
                onRenameGroup={handleRenameGroup}
                onDeleteGroup={handleDeleteGroup}
                onImport={() => void choosePhoneContacts()}
                onRescan={() => void handleRefresh()}
                refreshing={refreshing}
                tablet={tablet}
              />
            ),
          }}
        >
          <PersonPage
            detail={selectedId ? detail : null}
            loading={loadingShell || detailLoading}
            today={today}
            upcoming={upcoming}
            groups={groups}
            memberGroupIds={memberGroupIds}
            editing={editing}
            setEditing={setEditing}
            onSave={saveContact}
            onDelete={() => detail && handleDelete(detail.id)}
            onToggleFavorite={handleToggleFavorite}
            onAddToGroup={handleAddToGroup}
            onRemoveFromGroup={handleRemoveFromGroup}
            onToggleCommitment={handleToggleCommitment}
            onDeleteCommitment={handleDeleteCommitment}
            onAddCommitment={handleAddCommitment}
            onOpenMention={goToMention}
            notices={notices}
            empty={
              noPeople ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <Users className="h-9 w-9 text-ink-700" />
                  <p className="text-[0.9375rem] font-medium text-ink-300">
                    No people yet
                  </p>
                  <p className="max-w-sm text-[0.8125rem] text-ink-600">
                    Add a contact — then every note that mentions their name
                    builds their timeline automatically.
                  </p>
                  <div className="mt-1 w-full max-w-xs">
                    <NewPersonInput onCreate={handleCreate} />
                  </div>
                </div>
              ) : undefined
            }
          />
        </PageLayout>
      </div>
    </div>
  );
}
