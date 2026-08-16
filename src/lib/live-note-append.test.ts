import { describe, expect, it } from "vitest";

import { docFromBlocks, paragraph } from "./lexical-build";
import {
  appendBlocksToSerializedState,
  appendToLiveNote,
  registerLiveNoteAppender,
} from "./live-note-append";

describe("appendBlocksToSerializedState", () => {
  it("appends onto an empty document", () => {
    const block = paragraph("moved");
    const next = appendBlocksToSerializedState(null, [block]);
    expect(next.root.children).toEqual([block]);
  });

  it("appends after existing children", () => {
    const existing = paragraph("already here");
    const incoming = paragraph("new");
    const next = appendBlocksToSerializedState(docFromBlocks([existing]), [
      incoming,
    ]);
    expect(next.root.children).toEqual([existing, incoming]);
  });

  it("does not mutate the input document", () => {
    const existing = paragraph("keep");
    const original = docFromBlocks([existing]);
    const before = JSON.stringify(original);
    appendBlocksToSerializedState(original, [paragraph("extra")]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("treats a missing children array as empty", () => {
    const broken = {
      root: { type: "root", version: 1 },
    } as unknown as Parameters<typeof appendBlocksToSerializedState>[0];
    const block = paragraph("recovered");
    const next = appendBlocksToSerializedState(broken, [block]);
    expect(next.root.children).toEqual([block]);
  });
});

describe("live note appender registry", () => {
  it("delivers blocks to the registered handler and unregisters", () => {
    const received: unknown[][] = [];
    const stop = registerLiveNoteAppender("note-1", (blocks) => {
      received.push(blocks);
    });
    expect(appendToLiveNote("note-1", [{ type: "paragraph" }])).toBe(true);
    expect(received).toEqual([[{ type: "paragraph" }]]);
    stop();
    expect(appendToLiveNote("note-1", [{ type: "paragraph" }])).toBe(false);
  });

  it("returns false when no editor is mounted", () => {
    expect(appendToLiveNote("missing", [])).toBe(false);
  });
});
