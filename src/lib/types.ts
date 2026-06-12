export interface Section {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface Folder {
  id: string;
  sectionId: string;
  parentFolderId: string | null;
  name: string;
  createdAt: number;
}

export interface Note {
  id: string;
  sectionId: string;
  folderId: string | null;
  title: string;
  /** Serialized Lexical editor state (JSON string). Empty string = blank note. */
  content: string;
  /** Plain-text snapshot of the content, kept in sync for search. */
  textContent: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotariumData {
  sections: Section[];
  folders: Folder[];
  notes: Note[];
}
