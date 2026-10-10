"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ContactRound, Users, X } from "lucide-react";

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
import { localDateString } from "@/lib/dates";
import { useTabletLayout } from "@/lib/hooks/use-tablet-layout";

import {
  PeopleSidebar,
  PeopleSidebarActions,
  sortRecent,
  type ActiveGroup,
} from "./PeopleSidebar";
import { usePhoneParam } from "@/components/phone/use-phone-param";
import { PeoplePhone } from "./PeoplePhone";
import { PersonPage } from "./PersonPage";
import { NewPersonInput } from "./people-shared";

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

  // Phone: the person open full-screen, mirrored in ?person= (back = list).
  const {
    id: phoneOpenId,
    open: openPhoneParam,
    close: closePhonePerson,
  } = usePhoneParam("person");
  const openPhonePerson = useCallback(
    (id: string) => {
      setSelectedId(id);
      openPhoneParam(id);
    },
    [openPhoneParam],
  );

  // A phone person that no longer exists (deleted, bad link) → the list.
  useEffect(() => {
    if (people && phoneOpenId && !people.some((p) => p.id === phoneOpenId)) {
      closePhonePerson();
    }
  }, [people, phoneOpenId, closePhonePerson]);

  // Landing on / navigating back to ?person=: load that person's page.
  useEffect(() => {
    if (phoneOpenId) setSelectedId(phoneOpenId);
  }, [phoneOpenId]);

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
                    openPhonePerson(id);
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
      <PeoplePhone
        people={people}
        today={today}
        selectedId={selectedId}
        groups={groups}
        membersByGroup={membersByGroup}
        activeGroup={activeGroup}
        onActiveGroup={setActiveGroup}
        query={query}
        onQuery={setQuery}
        onCreatePerson={handleCreate}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onImport={() => void choosePhoneContacts()}
        onRescan={() => void handleRefresh()}
        refreshing={refreshing}
        notices={notices}
        openId={phoneOpenId}
        onOpen={openPhonePerson}
        onBack={closePhonePerson}
        detail={detail}
        detailLoading={detailLoading}
        upcoming={upcoming}
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
      />

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
