"use client";

import { useEffect, useRef, useState } from "react";
import {
  Import,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import type { PersonGroupItem, PersonListItem } from "@/app/app/people/actions";
import {
  SIDEBAR_FOCUS,
  SidebarIconButton,
  SidebarRow,
  SidebarSection,
} from "@/components/layout/sidebar";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";

import {
  ContactAvatar,
  NewPersonInput,
  formatTalkedDate,
} from "./people-shared";

/**
 * Sidebar 1 of the People page (Notes Sidebars design §5e / §6e): the
 * GROUPS section (Everyone, Close, then the user's own groups) and below it
 * RECENTLY SEEN — or, once a group or a search is active, that group's
 * people. On tablets the groups collapse into filter chips above one list.
 *
 * Selection model: `activeGroup` is `null` (nothing chosen — the "recently
 * seen" view), "all" (Everyone), "close" (favorites) or a group id.
 */

export type ActiveGroup = null | "all" | "close" | string;

export interface PeopleSidebarProps {
  people: PersonListItem[] | null;
  today: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  groups: PersonGroupItem[];
  /** groupId → member person ids. */
  membersByGroup: Map<string, Set<string>>;
  activeGroup: ActiveGroup;
  onActiveGroup: (g: ActiveGroup) => void;
  query: string;
  onQuery: (q: string) => void;
  addOpen: boolean;
  onAddDone: () => void;
  searchOpen: boolean;
  onCreatePerson: (name: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onImport: () => void;
  onRescan: () => void;
  refreshing: boolean;
  tablet: boolean;
}

/** Most recently seen first; never-mentioned people last, by name. */
export function sortRecent(list: PersonListItem[]): PersonListItem[] {
  return [...list].sort((a, b) => {
    const at = a.lastMentionedAt ? Date.parse(a.lastMentionedAt) : 0;
    const bt = b.lastMentionedAt ? Date.parse(b.lastMentionedAt) : 0;
    return bt - at || a.name.localeCompare(b.name);
  });
}

function personSubline(p: PersonListItem, today: string | null): string {
  const n = `${p.mentionCount} mention${p.mentionCount === 1 ? "" : "s"}`;
  return p.lastMentionedAt
    ? `${n} · last seen ${formatTalkedDate(p.lastMentionedAt, today)}`
    : n;
}

/** The people a group (or the default recents view / a search) lists. */
export function visiblePeople(
  people: PersonListItem[],
  activeGroup: ActiveGroup,
  membersByGroup: Map<string, Set<string>>,
  query: string,
  tablet: boolean,
): { list: PersonListItem[]; label: string } {
  const q = query.trim().toLowerCase();
  const group = tablet && activeGroup === null ? "all" : activeGroup;
  let base = people;
  let label = "Recently seen";
  if (group === "all") label = "Everyone";
  else if (group === "close") {
    base = people.filter((p) => p.isFavorite);
    label = "Close";
  } else if (group !== null) {
    const members = membersByGroup.get(group);
    base = people.filter((p) => members?.has(p.id));
    label = "";
  }
  if (q) {
    base = base.filter((p) =>
      `${p.name} ${p.phone ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q),
    );
    label = "Results";
  }
  let list = sortRecent(base);
  if (group === null && !q) list = list.slice(0, 10);
  return { list, label };
}

// ---------------------------------------------------------------------------
// small inline text field (new group / rename)
// ---------------------------------------------------------------------------

function InlineNameInput({
  initial = "",
  placeholder,
  label,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  label: string;
  onSubmit: (name: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="flex min-h-[2.3rem] items-center gap-1 px-3 py-1 touch:min-h-[3.4rem]">
      <input
        ref={ref}
        aria-label={label}
        value={value}
        maxLength={60}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const name = value.trim();
            if (name) void onSubmit(name);
            else onCancel();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!value.trim() || value.trim() === initial) onCancel();
        }}
        className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-input px-2 text-[0.875rem] text-ink-100 outline-none placeholder:text-ink-600 focus:border-sage/50 touch:h-11"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// group "more" menu (rename / delete)
// ---------------------------------------------------------------------------

function GroupMenu({
  onRename,
  onDelete,
  onClose,
  className,
}: {
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  useOutsideClose(true, ref, onClose);
  const item = `flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.875rem] touch:min-h-11 ${SIDEBAR_FOCUS}`;
  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute z-40 w-44 rounded-lg border border-white/8 bg-card py-1 shadow-xl ${className ?? ""}`}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onRename();
        }}
        className={`${item} text-ink-300 hover:bg-white/6`}
      >
        <Pencil className="h-3.5 w-3.5 text-ink-500" /> Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          onClose();
          onDelete();
        }}
        className={`${item} ${confirm ? "text-[#D9938A]" : "text-ink-300"} hover:bg-white/6`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {confirm ? "Delete group? Click to confirm" : "Delete group"}
      </button>
    </div>
  );
}

function GroupRow({
  group,
  count,
  active,
  editing,
  onSelect,
  onStartRename,
  onRename,
  onStopRename,
  onDelete,
}: {
  group: PersonGroupItem;
  count: number;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onStopRename: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  if (editing) {
    return (
      <InlineNameInput
        initial={group.name}
        label={`Rename ${group.name}`}
        placeholder="Group name"
        onSubmit={(name) => {
          onRename(name);
          onStopRename();
        }}
        onCancel={onStopRename}
      />
    );
  }
  return (
    <div
      className="group/grp relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <SidebarRow
        icon={Tag}
        label={group.name}
        count={count}
        active={active}
        onClick={onSelect}
      />
      <button
        type="button"
        aria-label={`${group.name} options`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
        className={`absolute top-1/2 right-9 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-200 focus-visible:opacity-100 touch:h-11 touch:w-11 touch:opacity-100 ${SIDEBAR_FOCUS} ${
          menu ? "opacity-100" : "opacity-0 group-hover/grp:opacity-100"
        }`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu && (
        <GroupMenu
          className="top-full right-2"
          onClose={() => setMenu(false)}
          onRename={onStartRename}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// people rows
// ---------------------------------------------------------------------------

function PersonRow({
  person,
  today,
  active,
  onSelect,
}: {
  person: PersonListItem;
  today: string | null;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div data-person-row={person.id}>
      <SidebarRow
        iconNode={
          <ContactAvatar
            person={person}
            size="h-7 w-7 text-[0.8125rem] touch:h-9 touch:w-9"
          />
        }
        label={person.name}
        sublabel={personSubline(person, today)}
        active={active}
        onClick={onSelect}
        trailing={
          person.isFavorite ? (
            <Star
              aria-label="Close"
              className="h-3 w-3 flex-none fill-area-amber text-area-amber"
            />
          ) : undefined
        }
      />
    </div>
  );
}

/** ↑/↓ move focus between rows of the list; Home/End jump to the ends. */
function onListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const rows = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-person-row] > button",
    ),
  );
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  let next = at;
  if (e.key === "ArrowDown") next = Math.min(rows.length - 1, at + 1);
  else if (e.key === "ArrowUp") next = Math.max(0, at - 1);
  else if (e.key === "Home") next = 0;
  else next = rows.length - 1;
  if (next === at && at !== -1) return;
  e.preventDefault();
  rows[Math.max(0, next)]?.focus();
}

// ---------------------------------------------------------------------------
// the sidebar
// ---------------------------------------------------------------------------

export function PeopleSidebar(props: PeopleSidebarProps) {
  const {
    people,
    today,
    selectedId,
    onSelect,
    groups,
    membersByGroup,
    activeGroup,
    onActiveGroup,
    query,
    onQuery,
    addOpen,
    onAddDone,
    searchOpen,
    onCreatePerson,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
    onImport,
    onRescan,
    refreshing,
    tablet,
  } = props;

  const [newGroup, setNewGroup] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tabletMenu, setTabletMenu] = useState(false);

  const all = people ?? [];
  const closeCount = all.filter((p) => p.isFavorite).length;
  const { list, label } = visiblePeople(
    all,
    activeGroup,
    membersByGroup,
    query,
    tablet,
  );
  const activeUserGroup = groups.find((g) => g.id === activeGroup) ?? null;
  const listLabel = label || activeUserGroup?.name || "People";
  const chipGroup = activeGroup ?? "all";

  const toggle = (g: Exclude<ActiveGroup, null>) =>
    onActiveGroup(activeGroup === g ? null : g);

  const groupsSection = (
    <SidebarSection
      label="Groups"
      storageKey="people.groups"
      actions={
        <SidebarIconButton
          icon={Plus}
          label="New group"
          onClick={() => setNewGroup(true)}
        />
      }
    >
      <SidebarRow
        icon={Users}
        label="Everyone"
        count={all.length}
        active={activeGroup === "all"}
        onClick={() => toggle("all")}
      />
      <SidebarRow
        icon={Star}
        label="Close"
        count={closeCount}
        active={activeGroup === "close"}
        onClick={() => toggle("close")}
      />
      {groups.map((g) => (
        <GroupRow
          key={g.id}
          group={g}
          count={membersByGroup.get(g.id)?.size ?? 0}
          active={activeGroup === g.id}
          editing={renamingId === g.id}
          onSelect={() => toggle(g.id)}
          onStartRename={() => setRenamingId(g.id)}
          onRename={(name) => onRenameGroup(g.id, name)}
          onStopRename={() => setRenamingId(null)}
          onDelete={() => onDeleteGroup(g.id)}
        />
      ))}
      {newGroup && (
        <InlineNameInput
          label="New group name"
          placeholder="New group…"
          onSubmit={async (name) => {
            setNewGroup(false);
            await onCreateGroup(name);
          }}
          onCancel={() => setNewGroup(false)}
        />
      )}
    </SidebarSection>
  );

  const chips = (
    <div className="flex-none border-b border-white/6">
      <div
        role="group"
        aria-label="Filter by group"
        className="flex gap-1.5 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]"
      >
        {(
          [
            { id: "all", name: "Everyone" },
            { id: "close", name: "Close" },
            ...groups,
          ] as Array<{ id: string; name: string }>
        ).map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={chipGroup === g.id}
            onClick={() => onActiveGroup(g.id === "all" ? null : g.id)}
            className={`h-8 flex-none rounded-full px-3 text-[0.875rem] whitespace-nowrap transition-colors touch:h-11 touch:px-4 ${SIDEBAR_FOCUS} ${
              chipGroup === g.id
                ? "bg-sage/16 text-sage"
                : "bg-white/6 text-ink-300 hover:bg-white/10"
            }`}
          >
            {g.name}
          </button>
        ))}
        <button
          type="button"
          aria-label="New group"
          title="New group"
          onClick={() => setNewGroup(true)}
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/6 text-ink-400 hover:bg-white/10 touch:h-11 touch:w-11 ${SIDEBAR_FOCUS}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {newGroup && (
        <InlineNameInput
          label="New group name"
          placeholder="New group…"
          onSubmit={async (name) => {
            setNewGroup(false);
            await onCreateGroup(name);
          }}
          onCancel={() => setNewGroup(false)}
        />
      )}
      {activeUserGroup && (
        <div className="relative flex items-center gap-1 px-4 pb-2 text-[0.8125rem] text-ink-500">
          {renamingId === activeUserGroup.id ? (
            <div className="flex-1">
              <InlineNameInput
                initial={activeUserGroup.name}
                label={`Rename ${activeUserGroup.name}`}
                placeholder="Group name"
                onSubmit={(name) => {
                  onRenameGroup(activeUserGroup.id, name);
                  setRenamingId(null);
                }}
                onCancel={() => setRenamingId(null)}
              />
            </div>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">
                {activeUserGroup.name} ·{" "}
                {membersByGroup.get(activeUserGroup.id)?.size ?? 0}
              </span>
              <SidebarIconButton
                icon={MoreHorizontal}
                label={`${activeUserGroup.name} options`}
                expanded={tabletMenu}
                onClick={() => setTabletMenu((v) => !v)}
              />
              {tabletMenu && (
                <GroupMenu
                  className="top-full right-2"
                  onClose={() => setTabletMenu(false)}
                  onRename={() => setRenamingId(activeUserGroup.id)}
                  onDelete={() => onDeleteGroup(activeUserGroup.id)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  const rows =
    people === null ? (
      <div className="flex flex-col gap-1.5 p-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>
    ) : list.length === 0 ? (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-ink-600">
        {query.trim()
          ? `No contacts match “${query.trim()}”.`
          : "Nobody here yet."}
      </p>
    ) : (
      <div onKeyDown={onListKeyDown}>
        {list.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            today={today}
            active={p.id === selectedId}
            onSelect={() => onSelect(p.id)}
          />
        ))}
      </div>
    );

  return (
    <>
      {addOpen && (
        <div className="flex-none border-b border-white/6 p-2">
          <NewPersonInput
            autoFocus
            onCreate={async (name) => {
              await onCreatePerson(name);
              onAddDone();
            }}
          />
        </div>
      )}
      {searchOpen && (
        <div className="flex-none border-b border-white/6 p-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-input px-2.5 py-2">
            <Search className="h-3.5 w-3.5 flex-none text-ink-600" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink-100 outline-none placeholder:text-ink-600"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onQuery("")}
                className="text-ink-500 hover:text-ink-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>
      )}

      {tablet ? (
        <>
          {chips}
          <div className="min-h-0 flex-1 overflow-y-auto">{rows}</div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groupsSection}
          <SidebarSection
            label={listLabel}
            count={people === null ? undefined : list.length}
            storageKey="people.list"
          >
            {rows}
          </SidebarSection>
        </div>
      )}

      <div className="flex-none border-t border-white/6 py-1">
        <SidebarRow
          icon={Import}
          label="Import contacts"
          dim
          onClick={onImport}
        />
        <SidebarRow
          iconNode={
            refreshing ? (
              <Loader2 className="h-4 w-4 flex-none animate-spin text-ink-500" />
            ) : (
              <RefreshCw className="h-4 w-4 flex-none text-ink-500" />
            )
          }
          label="Rescan notes"
          dim
          onClick={onRescan}
          title="Rebuild every person's mentions from your notes"
        />
      </div>
    </>
  );
}

/** Header action buttons for sidebar 1 (add person, search). */
export function PeopleSidebarActions({
  addOpen,
  searchOpen,
  onToggleAdd,
  onToggleSearch,
}: {
  addOpen: boolean;
  searchOpen: boolean;
  onToggleAdd: () => void;
  onToggleSearch: () => void;
}) {
  return (
    <>
      <SidebarIconButton
        icon={UserPlus}
        label="Add person"
        pressed={addOpen}
        active={addOpen}
        onClick={onToggleAdd}
      />
      <SidebarIconButton
        icon={Search}
        label="Search people"
        pressed={searchOpen}
        active={searchOpen}
        onClick={onToggleSearch}
      />
    </>
  );
}
