"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Folder, Note, NotariumData, Section } from "./types";

// MVP persistence layer: localStorage. The reducer below is the single write
// path for all data, so swapping this for API routes backed by Neon later
// only means replacing how `NotariumData` is loaded and saved.

const STORAGE_KEY = "notarium-data-v1";

export type Action =
  | { type: "addSection"; name: string; color?: string }
  | { type: "renameSection"; id: string; name: string }
  | { type: "deleteSection"; id: string }
  | { type: "addFolder"; sectionId: string; parentFolderId: string | null; name: string }
  | { type: "renameFolder"; id: string; name: string }
  | { type: "deleteFolder"; id: string }
  | { type: "addNote"; sectionId: string; folderId: string | null; title?: string }
  | { type: "renameNote"; id: string; title: string }
  | { type: "updateNoteContent"; id: string; content: string; textContent: string }
  | { type: "deleteNote"; id: string }
  | { type: "load"; data: NotariumData };

const SECTION_COLORS = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function newNote(sectionId: string, folderId: string | null, title = "Untitled"): Note {
  const now = Date.now();
  return {
    id: uid(),
    sectionId,
    folderId,
    title,
    content: "",
    textContent: "",
    createdAt: now,
    updatedAt: now,
  };
}

function seedData(): NotariumData {
  const sections: Section[] = ["Money", "Health", "Learning", "Personal"].map(
    (name, i) => ({
      id: uid(),
      name,
      color: SECTION_COLORS[i % SECTION_COLORS.length],
      createdAt: Date.now(),
    })
  );
  const welcome = newNote(sections[3].id, null, "Welcome to Notarium");
  welcome.textContent =
    "Dump everything in your brain here so you don't have to think about it anymore.";
  return { sections, folders: [], notes: [welcome] };
}

function descendantFolderIds(folders: Folder[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentFolderId && ids.has(f.parentFolderId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

// `hydrated` distinguishes the empty SSR-safe initial state from data actually
// loaded from localStorage, so we never overwrite storage with the former.
type StoreState = NotariumData & { hydrated: boolean };

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case "load":
      return { ...action.data, hydrated: true };
    case "addSection":
      return {
        ...state,
        sections: [
          ...state.sections,
          {
            id: uid(),
            name: action.name,
            color:
              action.color ??
              SECTION_COLORS[state.sections.length % SECTION_COLORS.length],
            createdAt: Date.now(),
          },
        ],
      };
    case "renameSection":
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.id === action.id ? { ...s, name: action.name } : s
        ),
      };
    case "deleteSection":
      return {
        ...state,
        sections: state.sections.filter((s) => s.id !== action.id),
        folders: state.folders.filter((f) => f.sectionId !== action.id),
        notes: state.notes.filter((n) => n.sectionId !== action.id),
      };
    case "addFolder":
      return {
        ...state,
        folders: [
          ...state.folders,
          {
            id: uid(),
            sectionId: action.sectionId,
            parentFolderId: action.parentFolderId,
            name: action.name,
            createdAt: Date.now(),
          },
        ],
      };
    case "renameFolder":
      return {
        ...state,
        folders: state.folders.map((f) =>
          f.id === action.id ? { ...f, name: action.name } : f
        ),
      };
    case "deleteFolder": {
      const doomed = descendantFolderIds(state.folders, action.id);
      return {
        ...state,
        folders: state.folders.filter((f) => !doomed.has(f.id)),
        notes: state.notes.filter((n) => !n.folderId || !doomed.has(n.folderId)),
      };
    }
    case "addNote":
      return {
        ...state,
        notes: [...state.notes, newNote(action.sectionId, action.folderId, action.title)],
      };
    case "renameNote":
      return {
        ...state,
        notes: state.notes.map((n) =>
          n.id === action.id ? { ...n, title: action.title, updatedAt: Date.now() } : n
        ),
      };
    case "updateNoteContent":
      return {
        ...state,
        notes: state.notes.map((n) =>
          n.id === action.id
            ? {
                ...n,
                content: action.content,
                textContent: action.textContent,
                updatedAt: Date.now(),
              }
            : n
        ),
      };
    case "deleteNote":
      return { ...state, notes: state.notes.filter((n) => n.id !== action.id) };
  }
}

interface StoreContextValue {
  data: NotariumData;
  dispatch: Dispatch<Action>;
  hydrated: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    sections: [],
    folders: [],
    notes: [],
    hydrated: false,
  });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    let loaded: NotariumData | null = null;
    if (raw) {
      try {
        loaded = JSON.parse(raw) as NotariumData;
      } catch {
        loaded = null;
      }
    }
    dispatch({ type: "load", data: loaded ?? seedData() });
  }, []);

  const { hydrated, ...data } = state;

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <StoreContext.Provider value={{ data, dispatch, hydrated }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
