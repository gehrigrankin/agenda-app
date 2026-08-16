import type { SerializedEditorState, SerializedLexicalNode } from "lexical";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MISSING_NOTE_FAILURE } from "./save-failure";
import {
  saveCardSectionRequest,
  saveNoteContentRequest,
} from "./note-content-transport";

const state = (text: string) =>
  ({
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [{ type: "text", version: 1, text }],
        },
      ],
    },
  }) as unknown as SerializedEditorState;

afterEach(() => vi.unstubAllGlobals());

describe("note content Route Handler transport", () => {
  it("sends content larger than the Server Action 1 MB limit over fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveNoteContentRequest("note/large", state("x".repeat(1_100_000))),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/notes/note%2Flarge/content");
    expect(init.method).toBe("PUT");
    expect(String(init.body).length).toBeGreaterThan(1_000_000);
  });

  it("preserves a structured failure returned with a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, failure: MISSING_NOTE_FAILURE }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(saveNoteContentRequest("gone", state("text"))).resolves.toEqual(
      { ok: false, failure: MISSING_NOTE_FAILURE },
    );
  });

  it("uses the same endpoint for scoped card-section autosaves", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const blocks = [{ type: "paragraph", children: [] }] as unknown as SerializedLexicalNode[];

    await saveCardSectionRequest("target", "anchor", blocks);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/notes/target/content");
    expect(JSON.parse(String(init.body))).toEqual({
      cardSection: { anchorId: "anchor", blocks },
    });
  });

  it("throws a classifiable stale-response error for non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gone", { status: 404 })),
    );

    await expect(saveNoteContentRequest("note", state("text"))).rejects.toThrow(
      "Unexpected response was received (404)",
    );
  });
});
