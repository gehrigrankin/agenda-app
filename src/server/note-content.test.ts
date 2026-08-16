import type { SerializedEditorState } from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./notes", () => ({
  getNote: vi.fn(),
  updateNoteContent: vi.fn(),
  reconcileNoteLinks: vi.fn(),
}));
vi.mock("./tasks", () => ({ reconcileNoteTasks: vi.fn() }));
vi.mock("./note-logs", () => ({ reconcileNoteLogs: vi.fn() }));

import * as noteLogsRepo from "./note-logs";
import {
  appendBlocksToNoteContent,
  saveNoteContent,
} from "./note-content";
import * as notesRepo from "./notes";
import * as tasksRepo from "./tasks";

const content = {
  root: {
    type: "root",
    children: [
      { type: "task", taskId: "task-1" },
      { type: "note-link", noteId: "note-2" },
      { type: "log-heading", logId: "log-1" },
    ],
  },
} as unknown as SerializedEditorState;

describe("saveNoteContent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves task, note-link, and note-log reconciliation", async () => {
    vi.mocked(notesRepo.updateNoteContent).mockResolvedValue({ id: "note-1" } as never);

    await expect(saveNoteContent("owner", "note-1", content)).resolves.toEqual({
      ok: true,
    });

    expect(notesRepo.updateNoteContent).toHaveBeenCalledWith("owner", "note-1", {
      content,
    });
    expect(tasksRepo.reconcileNoteTasks).toHaveBeenCalledWith(
      "owner",
      "note-1",
      content,
    );
    expect(notesRepo.reconcileNoteLinks).toHaveBeenCalledWith(
      "owner",
      "note-1",
      content,
    );
    expect(noteLogsRepo.reconcileNoteLogs).toHaveBeenCalledWith(
      "owner",
      "note-1",
      content,
    );
  });

  it("does not reconcile when the owner-scoped note update misses", async () => {
    vi.mocked(notesRepo.updateNoteContent).mockResolvedValue(undefined as never);

    const result = await saveNoteContent("owner", "gone", content);

    expect(result).toMatchObject({ ok: false, failure: { kind: "missing" } });
    expect(tasksRepo.reconcileNoteTasks).not.toHaveBeenCalled();
    expect(notesRepo.reconcileNoteLinks).not.toHaveBeenCalled();
    expect(noteLogsRepo.reconcileNoteLogs).not.toHaveBeenCalled();
  });

  it("reconciles derived rows after appending moved blocks", async () => {
    vi.mocked(notesRepo.getNote).mockResolvedValue({
      id: "note-1",
      content: { root: { type: "root", version: 1, children: [] } },
      deletedAt: null,
    } as never);
    vi.mocked(notesRepo.updateNoteContent).mockResolvedValue({
      id: "note-1",
    } as never);

    await expect(
      appendBlocksToNoteContent("owner", "note-1", content.root.children),
    ).resolves.toEqual({ ok: true });

    expect(tasksRepo.reconcileNoteTasks).toHaveBeenCalled();
    expect(notesRepo.reconcileNoteLinks).toHaveBeenCalled();
    expect(noteLogsRepo.reconcileNoteLogs).toHaveBeenCalled();
  });
});
