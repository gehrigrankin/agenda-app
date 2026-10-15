/**
 * Pure state model for the Notes editor's tabs and split panes (Notes
 * Sidebars design §3c): one or two panes side by side, each with its own tab
 * strip; the focused pane's tab underline is the accent.
 *
 * Invariant: a note lives in AT MOST ONE pane. Two live editors on one note
 * would race each other's saves (the revision CAS would then fail one of
 * them), so opening a note in the other pane MOVES its tab there.
 *
 * Kept free of React so the hook (use-editor-panes) stays a thin shell and the
 * rules are unit-tested.
 */

export interface NoteTab {
  id: string;
  /** Live title; "" until something authoritative reports one. */
  title: string;
}

export interface Pane {
  tabs: NoteTab[];
  active: string | null;
}

export interface PanesState {
  panes: Pane[]; // length 1 or 2
  focused: number; // index into panes
  /** Left pane's share of the width when split, 0.2–0.8. */
  ratio: number;
}

/** Runaway backstop per pane, not a working limit (matches the dock). */
export const MAX_TABS = 24;

export const EMPTY_PANES: PanesState = {
  panes: [{ tabs: [], active: null }],
  focused: 0,
  ratio: 0.5,
};

export function paneOf(state: PanesState, id: string): number {
  return state.panes.findIndex((p) => p.tabs.some((t) => t.id === id));
}

/** The note the focused pane shows (what the URL names). */
export function focusedNote(state: PanesState): string | null {
  return state.panes[state.focused]?.active ?? null;
}

function withPane(state: PanesState, i: number, pane: Pane): PanesState {
  const panes = state.panes.slice();
  panes[i] = pane;
  return { ...state, panes };
}

/** Neighbour a code editor focuses after closing: the tab that took its
 *  place, else the one before it. */
function neighbour(tabs: NoteTab[], index: number): string | null {
  return (tabs[index] ?? tabs[index - 1] ?? tabs[tabs.length - 1])?.id ?? null;
}

function removeFrom(pane: Pane, id: string): Pane {
  const index = pane.tabs.findIndex((t) => t.id === id);
  if (index < 0) return pane;
  const tabs = pane.tabs.filter((t) => t.id !== id);
  return {
    tabs,
    active: pane.active === id ? neighbour(tabs, index) : pane.active,
  };
}

/**
 * Open (or re-focus) a note. `target` picks the pane: "focused" (default),
 * "other" (⌥-click — splits if needed), or an index. A note already open in a
 * different pane than the target is moved, keeping its title.
 */
export function openNote(
  state: PanesState,
  id: string,
  title?: string,
  target: "focused" | "other" | number = "focused",
): PanesState {
  let s = state;
  let to: number;
  if (target === "other") {
    if (s.panes.length === 1)
      s = { ...s, panes: [...s.panes, { tabs: [], active: null }] };
    to = s.focused === 0 ? 1 : 0;
  } else if (target === "focused") {
    const where = paneOf(s, id);
    to = where >= 0 ? where : s.focused;
  } else {
    to = Math.min(target, s.panes.length - 1);
  }

  const from = paneOf(s, id);
  let existing: NoteTab | undefined;
  if (from >= 0 && from !== to) {
    existing = s.panes[from].tabs.find((t) => t.id === id);
    s = withPane(s, from, removeFrom(s.panes[from], id));
  }
  const pane = s.panes[to];
  const has = pane.tabs.find((t) => t.id === id);
  let tabs = pane.tabs;
  if (has) {
    if (title && has.title !== title)
      tabs = tabs.map((t) => (t.id === id ? { ...t, title } : t));
  } else {
    tabs = [...tabs, { id, title: title ?? existing?.title ?? "" }].slice(
      -MAX_TABS,
    );
  }
  s = withPane(s, to, { tabs, active: id });
  return collapseEmptySplit({ ...s, focused: to });
}

export function activateTab(
  state: PanesState,
  pane: number,
  id: string,
): PanesState {
  const p = state.panes[pane];
  if (!p || !p.tabs.some((t) => t.id === id)) return state;
  return { ...withPane(state, pane, { ...p, active: id }), focused: pane };
}

export function focusPane(state: PanesState, pane: number): PanesState {
  if (pane < 0 || pane >= state.panes.length || pane === state.focused)
    return state;
  return { ...state, focused: pane };
}

/** Close a tab. A split pane left with no tabs closes itself. */
export function closeTab(
  state: PanesState,
  pane: number,
  id: string,
): PanesState {
  const p = state.panes[pane];
  if (!p) return state;
  return collapseEmptySplit(withPane(state, pane, removeFrom(p, id)));
}

/** Drop an empty second pane (or an empty first one when split). */
function collapseEmptySplit(state: PanesState): PanesState {
  if (state.panes.length < 2) return state;
  const empty = state.panes.findIndex((p) => p.tabs.length === 0);
  if (empty < 0) return state;
  const panes = state.panes.filter((_, i) => i !== empty);
  return { ...state, panes, focused: 0 };
}

/**
 * Split the editor (the columns icon). The focused pane's most recently
 * listed OTHER tab moves into the new pane, so both sides show something;
 * with a single tab the new pane starts empty and waits for a note.
 */
export function split(state: PanesState): PanesState {
  if (state.panes.length > 1) return state;
  const p = state.panes[0];
  const other = [...p.tabs].reverse().find((t) => t.id !== p.active);
  if (!other) {
    return {
      ...state,
      panes: [p, { tabs: [], active: null }],
      focused: 1,
    };
  }
  return {
    ...state,
    panes: [removeFrom(p, other.id), { tabs: [other], active: other.id }],
    focused: 1,
  };
}

/** Merge both panes back into one, focused tab kept focused. */
export function unsplit(state: PanesState): PanesState {
  if (state.panes.length < 2) return state;
  const [a, b] = state.panes;
  const focusedId = focusedNote(state);
  return {
    ...state,
    panes: [
      {
        tabs: [...a.tabs, ...b.tabs].slice(-MAX_TABS),
        active: focusedId ?? a.active ?? b.active,
      },
    ],
    focused: 0,
  };
}

export function setTitle(
  state: PanesState,
  id: string,
  title: string,
): PanesState {
  const i = paneOf(state, id);
  if (i < 0) return state;
  const p = state.panes[i];
  const t = p.tabs.find((x) => x.id === id);
  if (!t || t.title === title) return state;
  return withPane(state, i, {
    ...p,
    tabs: p.tabs.map((x) => (x.id === id ? { ...x, title } : x)),
  });
}

/** Focus nothing in the focused pane (the "no note open" route). */
export function clearFocused(state: PanesState): PanesState {
  const p = state.panes[state.focused];
  if (!p || p.active === null) return state;
  return withPane(state, state.focused, { ...p, active: null });
}

/** Drop tabs whose notes no longer exist. */
export function retainNotes(
  state: PanesState,
  live: ReadonlySet<string>,
): PanesState {
  let s = state;
  for (let i = 0; i < s.panes.length; i++) {
    for (const t of s.panes[i].tabs) {
      if (!live.has(t.id)) s = withPane(s, i, removeFrom(s.panes[i], t.id));
    }
  }
  return collapseEmptySplit(s);
}

export function setRatio(state: PanesState, ratio: number): PanesState {
  const r = Math.min(0.8, Math.max(0.2, ratio));
  return r === state.ratio ? state : { ...state, ratio: r };
}

/** Parse a persisted value defensively; anything off reads as empty. */
export function parsePanes(raw: unknown): PanesState {
  if (typeof raw !== "object" || raw === null) return EMPTY_PANES;
  const r = raw as Record<string, unknown>;
  const panes = (Array.isArray(r.panes) ? r.panes : [])
    .slice(0, 2)
    .map((p): Pane => {
      const o = (typeof p === "object" && p !== null ? p : {}) as Record<
        string,
        unknown
      >;
      const tabs = (Array.isArray(o.tabs) ? o.tabs : [])
        .filter(
          (t): t is { id: string; title?: unknown } =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as { id?: unknown }).id === "string",
        )
        .map((t) => ({
          id: t.id,
          title: typeof t.title === "string" ? t.title : "",
        }))
        .slice(-MAX_TABS);
      const active =
        typeof o.active === "string" && tabs.some((t) => t.id === o.active)
          ? o.active
          : null;
      return { tabs, active };
    });
  // Enforce one-pane-per-note on restore too.
  const seen = new Set<string>();
  for (const p of panes) {
    p.tabs = p.tabs.filter((t) =>
      seen.has(t.id) ? false : (seen.add(t.id), true),
    );
    if (p.active && !p.tabs.some((t) => t.id === p.active)) p.active = null;
  }
  const nonEmpty = panes.filter((p) => p.tabs.length > 0);
  if (nonEmpty.length === 0) return EMPTY_PANES;
  const ratio =
    typeof r.ratio === "number" && Number.isFinite(r.ratio) ? r.ratio : 0.5;
  return {
    panes: nonEmpty,
    focused: 0,
    ratio: Math.min(0.8, Math.max(0.2, ratio)),
  };
}

/** Migrate the pre-split `agenda.note-tabs` shape ({tabs}). */
export function fromLegacyTabs(raw: unknown): PanesState {
  if (typeof raw !== "object" || raw === null) return EMPTY_PANES;
  return parsePanes({ panes: [{ tabs: (raw as { tabs?: unknown }).tabs }] });
}
