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
import { saveNoteContent } from "./note-content";
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
});
