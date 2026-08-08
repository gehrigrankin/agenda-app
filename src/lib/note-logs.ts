import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { lexicalToPlainText } from "./lexical-text";

/**
 * Extracting log sections from a serialized note.
 *
 * A "log heading" is a heading inserted by `[[+Target`: it links to another
 * note, and everything written UNDER it — up to the next heading of the same
 * or higher level — is logged onto that note.
 *
 * The subtlety is that headings in this editor are FLAT top-level siblings.
 * Nothing in the saved JSON nests a heading's content inside it; the section
 * is implied by document order. CollapsePlugin computes exactly this at
 * runtime to hide collapsed sections, walking siblings until it meets a
 * heading whose level is <= the opening heading's. This module is the
 * serialized twin of that walk, so what gets logged is precisely what
 * collapses — if the two ever disagreed, the section you can see would stop
 * matching the section you're sending.
 *
 * Pure: no DB, no Lexical runtime. The caller reconciles the result.
 */

/** Serialized type emitted by LogHeadingNode.exportJSON. */
export const LOG_HEADING_TYPE = "log-heading";

/** One `[[+` heading and the blocks it owns. */
export interface LogSection {
  /** Stable id minted when the heading was inserted — the log row's identity. */
  logId: string;
  /** The note being logged to. */
  noteId: string;
  /** Heading text as written (falls back to the target's title snapshot). */
  heading: string;
  /** The blocks under the heading, in document order. May be empty. */
  blocks: SerializedLexicalNode[];
}

interface MaybeHeading {
  type?: unknown;
  tag?: unknown;
  logId?: unknown;
  noteId?: unknown;
  title?: unknown;
  children?: unknown;
}

/**
 * h1→1 … h6→6, anything unrecognized→6. Matches CollapsePlugin's `levelOf`:
 * an unparseable tag sorts as the deepest level, so it closes nothing.
 */
function levelOf(tag: unknown): number {
  return typeof tag === "string" ? Number(tag.slice(1)) || 6 : 6;
}

/** Any heading — plain, collapsible, or a log heading. */
function isHeading(node: MaybeHeading): boolean {
  return (
    node.type === "heading" ||
    node.type === "collapsible-heading" ||
    node.type === LOG_HEADING_TYPE
  );
}

function isLogHeading(node: MaybeHeading): boolean {
  return (
    node.type === LOG_HEADING_TYPE &&
    typeof node.logId === "string" &&
    node.logId.length > 0 &&
    typeof node.noteId === "string" &&
    node.noteId.length > 0
  );
}

/** The heading's own text, for the log's label. */
function headingText(node: MaybeHeading): string {
  const text = lexicalToPlainText(
    { root: { ...(node as object), type: "root" } } as SerializedEditorState,
    200,
  ).trim();
  if (text) return text;
  return typeof node.title === "string" ? node.title : "";
}

/**
 * Every log section in the note, in document order.
 *
 * Only TOP-LEVEL headings are considered — the same restriction CollapsePlugin
 * puts on its chevrons. A heading nested inside a list or quote has no
 * well-defined "following siblings at document level", and allowing one would
 * make the logged region depend on where the nesting ended.
 *
 * A log heading with no content under it still yields a section with zero
 * blocks: the user made the link deliberately, and an empty log that fills in
 * as they type beats one that appears only once it's long enough.
 */
export function collectLogSections(
  state: SerializedEditorState | null | undefined,
): LogSection[] {
  const root = (state as { root?: MaybeHeading } | null | undefined)?.root;
  const children = root?.children;
  if (!Array.isArray(children)) return [];

  const sections: LogSection[] = [];
  let open: { section: LogSection; level: number } | null = null;

  for (const raw of children) {
    const block = raw as SerializedLexicalNode & MaybeHeading;

    if (isHeading(block)) {
      const level = levelOf(block.tag);
      // A heading at the same or higher level ends the section it meets.
      // A DEEPER one is part of the log — a sub-heading you wrote under the
      // call belongs to the call.
      if (open && level <= open.level) open = null;

      if (isLogHeading(block) && !open) {
        const section: LogSection = {
          logId: block.logId as string,
          noteId: block.noteId as string,
          heading: headingText(block),
          blocks: [],
        };
        sections.push(section);
        open = { section, level };
        continue;
      }
      // A log heading nested inside another log's section is logged as part
      // of that section rather than opening its own — one block of text can't
      // honestly belong to two logs.
    }

    if (open) open.section.blocks.push(block);
  }

  return sections;
}

/** Plain-text mirror of a section's blocks, for the panel and for search. */
export function logSectionText(
  blocks: SerializedLexicalNode[],
  max = 2000,
): string {
  if (blocks.length === 0) return "";
  return lexicalToPlainText(
    {
      root: {
        type: "root",
        children: blocks,
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
    } as unknown as SerializedEditorState,
    max,
  );
}
