import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { docFromBlocks, heading, paragraph, quote, textNode } from "./lexical-build";

/**
 * Markdown ⇄ serialized Lexical, for the MCP API: assistants speak markdown,
 * notes are stored as serialized editor state (JSONB).
 *
 * This is a deliberate SUBSET, not a markdown implementation. The point is a
 * lossless-enough round trip for the things an assistant actually writes, with
 * a boundary you can hold in your head, rather than a parser that quietly
 * invents node shapes the editor has never seen.
 *
 * PARSED (markdown → blocks):
 * - ATX headings `#`..`######` → `heading` with the matching `tag`
 * - Paragraphs: a run of non-blank lines becomes ONE paragraph whose internal
 *   newlines are `linebreak` nodes (what shift+enter produces in the editor),
 *   so the run survives the round trip line for line
 * - Bullet (`-`, `*`) and numbered (`1.`) lists → a `list` block containing
 *   `listitem` children. Shape taken from @lexical/list's SerializedListNode /
 *   SerializedListItemNode: `{listType, tag, start}` and `{value, checked}`.
 *   The editor replaces ListItemNode with CollapsibleListItemNode, but that
 *   replacement upgrades plain `listitem` JSON on load, so we emit the stock
 *   type.
 * - Blockquotes: a run of `>` lines → one `quote` block, linebreak-separated
 * - Fenced code ``` ``` ``` → one paragraph per line, text verbatim. The editor
 *   has no code node we can emit with confidence, and a wrong guess is worse
 *   than plain text. The fences themselves are dropped, so code is the one
 *   construct that does NOT round-trip.
 *
 * NOT PARSED, on purpose:
 * - Inline formatting. Bold/italic/links/`[[wiki links]]` stay PLAIN TEXT in a
 *   single text node; nothing is turned into formatted or link nodes.
 * - Task lines. `- [ ] x` / `- [x] x` parse as ORDINARY list items keeping the
 *   `[ ]`/`[x]` marker in their text — never as `task` nodes. A task node
 *   carries a `taskId` naming a real `tasks` row (see `taskNode` in
 *   lexical-build, and TaskNode.tsx), and this module is pure: it cannot mint
 *   one. The API layer creates the task rows and swaps the nodes in.
 * - Nesting. Indented list items are flattened into their parent list;
 *   indentation is not preserved.
 * - Setext headings, tables, horizontal rules, footnotes: unrecognized lines
 *   are paragraphs.
 *
 * RENDERED (blocks → markdown): everything above, plus the node types this
 * app's editor adds — `timed-paragraph`, `collapsible-heading`, `log-heading`,
 * `collapsible-listitem`, check lists, `task` (as `- [ ] title`) and inline
 * `note-link` (as `[[Title]]`). An unknown block falls back to its extracted
 * plain text on a line of its own rather than being dropped; a block with no
 * text at all (an image, an empty trailing paragraph) contributes nothing.
 *
 * `blocksToMarkdown(markdownToBlocks(md)) === md` for documents inside the
 * parsed subset, modulo two normalizations: `*` bullets become `-`, and
 * paragraph lines are trimmed.
 */

/** Serialized Lexical blocks (the `root.children` array of a note). */
export type LexicalBlocks = SerializedLexicalNode[];

/** The loose view of a serialized node we read while walking untrusted JSON. */
interface MaybeBlock {
  type?: unknown;
  tag?: unknown;
  text?: unknown;
  title?: unknown;
  children?: unknown;
  listType?: unknown;
  start?: unknown;
  value?: unknown;
  checked?: unknown;
  completed?: unknown;
}

/** The `lexical-build` builders return an open record; blocks are typed nodes. */
function asBlock(node: object): SerializedLexicalNode {
  return node as unknown as SerializedLexicalNode;
}

// ---------------------------------------------------------------------------
// markdown → blocks
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^\s*```/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUMBER_RE = /^\s*(\d{1,9})\.\s+(.*)$/;

const LINEBREAK = { type: "linebreak", version: 1 };

type ListType = "bullet" | "number";

interface ListItemLine {
  listType: ListType;
  text: string;
  /** The written number for `1.` items; null for bullets (position wins). */
  value: number | null;
}

function matchListItem(line: string): ListItemLine | null {
  const numbered = NUMBER_RE.exec(line);
  if (numbered) {
    return {
      listType: "number",
      text: numbered[2].trim(),
      value: Number(numbered[1]),
    };
  }
  const bullet = BULLET_RE.exec(line);
  if (bullet) return { listType: "bullet", text: bullet[1].trim(), value: null };
  return null;
}

/** A line that continues a plain paragraph run rather than opening a block. */
function isParagraphLine(line: string): boolean {
  return (
    line.trim() !== "" &&
    !FENCE_OPEN_RE.test(line) &&
    !HEADING_RE.test(line) &&
    !QUOTE_RE.test(line) &&
    matchListItem(line) === null
  );
}

/** Text lines as a single inline run, with `linebreak` nodes between them. */
function inlineChildren(lines: string[]): unknown[] {
  const children: unknown[] = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push(LINEBREAK);
    if (line.length > 0) children.push(textNode(line));
  });
  return children;
}

/**
 * `heading()` only types tags up to h3; markdown goes to h6, so the tag is
 * overridden on the builder's output instead of rebuilding the node here.
 */
function headingBlock(text: string, level: number): SerializedLexicalNode {
  return asBlock({ ...heading(text), tag: `h${level}` });
}

function paragraphBlock(lines: string[]): SerializedLexicalNode {
  if (lines.length <= 1) return asBlock(paragraph(lines[0] ?? ""));
  return asBlock({ ...paragraph(""), children: inlineChildren(lines) });
}

function quoteBlock(lines: string[]): SerializedLexicalNode {
  if (lines.length <= 1) return asBlock(quote(lines[0] ?? ""));
  return asBlock({ ...quote(""), children: inlineChildren(lines) });
}

function listItemBlock(text: string, value: number): SerializedLexicalNode {
  return asBlock({
    type: "listitem",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    value,
    children: text.length > 0 ? [textNode(text)] : [],
  });
}

function listBlock(
  listType: ListType,
  start: number,
  items: SerializedLexicalNode[],
): SerializedLexicalNode {
  return asBlock({
    type: "list",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    listType,
    tag: listType === "number" ? "ol" : "ul",
    start,
    children: items,
  });
}

/** Parse markdown into serialized Lexical blocks. */
export function markdownToBlocks(markdown: string): LexicalBlocks {
  if (typeof markdown !== "string" || markdown.length === 0) return [];

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: LexicalBlocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank lines only separate blocks; they never produce one.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code: verbatim lines, fences dropped. An unterminated fence runs
    // to the end of the document rather than failing.
    if (FENCE_OPEN_RE.test(line)) {
      i++;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        blocks.push(asBlock(paragraph(lines[i])));
        i++;
      }
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      blocks.push(headingBlock(headingMatch[2].trim(), headingMatch[1].length));
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      let match = QUOTE_RE.exec(lines[i]);
      while (i < lines.length && match) {
        quoted.push(match[1].trimEnd());
        i++;
        match = i < lines.length ? QUOTE_RE.exec(lines[i]) : null;
      }
      blocks.push(quoteBlock(quoted));
      continue;
    }

    const firstItem = matchListItem(line);
    if (firstItem) {
      // One list per run of items of the SAME type; switching marker or
      // hitting a blank line starts a new block.
      const items: SerializedLexicalNode[] = [];
      let start = firstItem.value ?? 1;
      let item: ListItemLine | null = firstItem;
      while (i < lines.length && item && item.listType === firstItem.listType) {
        const value = item.value ?? items.length + 1;
        if (items.length === 0) start = value;
        items.push(listItemBlock(item.text, value));
        i++;
        item = i < lines.length ? matchListItem(lines[i]) : null;
      }
      blocks.push(listBlock(firstItem.listType, start, items));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && isParagraphLine(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(paragraphBlock(para));
  }

  return blocks;
}

/** Parse markdown into a whole serialized editor state (a `{root: ...}` doc). */
export function markdownToDoc(markdown: string): SerializedEditorState {
  return docFromBlocks(
    markdownToBlocks(markdown) as unknown as Parameters<typeof docFromBlocks>[0],
  );
}

// ---------------------------------------------------------------------------
// blocks → markdown
// ---------------------------------------------------------------------------

/** `[[Title]]` for a note-link chip (its text lives in `title`). */
function noteLinkText(node: MaybeBlock): string {
  return `[[${typeof node.title === "string" ? node.title : ""}]]`;
}

/**
 * A block's inline content, split at `linebreak` nodes. Always at least one
 * (possibly empty) line. Nested `list` children are skipped — they are block
 * structure the caller renders itself, not part of this block's own text.
 */
function inlineLines(node: MaybeBlock): string[] {
  const lines: string[] = [""];
  const append = (s: string) => {
    lines[lines.length - 1] += s;
  };

  const walk = (n: MaybeBlock) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "linebreak") {
      lines.push("");
      return;
    }
    if (typeof n.text === "string") {
      append(n.text);
      return;
    }
    if (n.type === "note-link") {
      append(noteLinkText(n));
      return;
    }
    // Decorator chips carrying their text in `title` (a task nested inside
    // another block, say) would otherwise be invisible.
    if (n.type === "task" && typeof n.title === "string") {
      append(n.title);
      return;
    }
    if (n.type === "list") return;
    const children = Array.isArray(n.children) ? n.children : [];
    for (const child of children) walk(child as MaybeBlock);
  };

  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) walk(child as MaybeBlock);
  return lines;
}

/** A block's inline content as one line. */
function inlineText(node: MaybeBlock): string {
  return inlineLines(node).join(" ").trim();
}

/** h1→1 … h6→6; an unrecognized tag renders as `#` rather than vanishing. */
function headingLevel(tag: unknown): number {
  if (typeof tag !== "string") return 1;
  const level = Number(tag.slice(1));
  return level >= 1 && level <= 6 ? level : 1;
}

function isListItem(type: unknown): boolean {
  return type === "listitem" || type === "collapsible-listitem";
}

function renderListItem(
  item: MaybeBlock,
  listType: string,
  value: number,
  depth: number,
): string | null {
  const indent = "  ".repeat(depth);
  const marker =
    listType === "number"
      ? `${value}. `
      : listType === "check"
        ? item.checked === true
          ? "- [x] "
          : "- [ ] "
        : "- ";

  // Lexical wraps a nested sublist in its own textless <li> right after the
  // row it belongs to; render that one as the sublist alone, not an empty
  // bullet followed by the sublist.
  const children = Array.isArray(item.children) ? item.children : [];
  const nested: string[] = [];
  for (const child of children) {
    const node = child as MaybeBlock;
    if (node && typeof node === "object" && node.type === "list") {
      const rendered = renderList(node, depth + 1);
      if (rendered !== null) nested.push(rendered);
    }
  }

  const text = inlineText(item);
  if (text.length === 0) {
    if (nested.length > 0) return nested.join("\n");
    return `${indent}${marker}`.trimEnd();
  }
  return [`${indent}${marker}${text}`, ...nested].join("\n");
}

function renderList(list: MaybeBlock, depth: number): string | null {
  const children = Array.isArray(list.children) ? list.children : [];
  const listType =
    list.listType === "number" || list.listType === "check"
      ? list.listType
      : "bullet";

  const lines: string[] = [];
  let counter =
    typeof list.start === "number" && Number.isFinite(list.start)
      ? list.start
      : 1;

  for (const child of children) {
    const node = child as MaybeBlock;
    if (!node || typeof node !== "object") continue;
    // A list directly inside a list (rather than inside an item) is malformed
    // but easy to keep: render it one level deeper.
    if (node.type === "list") {
      const rendered = renderList(node, depth + 1);
      if (rendered !== null) lines.push(rendered);
      continue;
    }
    if (!isListItem(node.type)) continue;
    const value =
      typeof node.value === "number" && Number.isFinite(node.value)
        ? node.value
        : counter;
    const rendered = renderListItem(node, listType, value, depth);
    if (rendered !== null) lines.push(rendered);
    counter = value + 1;
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/** One block's markdown, or null when it has nothing to contribute. */
function renderBlock(block: MaybeBlock): string | null {
  switch (block.type) {
    case "paragraph":
    case "timed-paragraph": {
      const text = inlineLines(block).join("\n");
      return text.trim().length > 0 ? text : null;
    }
    case "heading":
    case "collapsible-heading":
    case "log-heading": {
      // A log heading keeps a title snapshot for when its text is empty.
      const text =
        inlineText(block) || (typeof block.title === "string" ? block.title : "");
      return `${"#".repeat(headingLevel(block.tag))} ${text}`.trimEnd();
    }
    case "quote":
      return inlineLines(block)
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    case "list":
      return renderList(block, 0);
    case "listitem":
    case "collapsible-listitem":
      // A stray item outside any list still deserves a bullet.
      return renderListItem(block, "bullet", 1, 0);
    case "task": {
      const mark = block.completed === true ? "x" : " ";
      const title = typeof block.title === "string" ? block.title : "";
      return `- [${mark}] ${title}`.trimEnd();
    }
    case "note-link":
      return noteLinkText(block);
    default: {
      const text = inlineText(block);
      return text.length > 0 ? text : null;
    }
  }
}

/** Render serialized Lexical blocks back to markdown. */
export function blocksToMarkdown(blocks: LexicalBlocks): string {
  if (!Array.isArray(blocks)) return "";

  const rendered: { md: string; tight: boolean }[] = [];
  for (const raw of blocks) {
    const block = raw as MaybeBlock;
    if (!block || typeof block !== "object") continue;
    const md = renderBlock(block);
    if (md === null) continue;
    // Consecutive task chips are one visual checklist in the editor; a blank
    // line between them would read as separate lists.
    rendered.push({ md, tight: block.type === "task" });
  }

  let out = "";
  rendered.forEach((entry, i) => {
    if (i > 0) out += entry.tight && rendered[i - 1].tight ? "\n" : "\n\n";
    out += entry.md;
  });
  return out;
}

/** Render a whole serialized editor state to markdown. */
export function docToMarkdown(
  state: SerializedEditorState | null | undefined,
): string {
  const root = (state as { root?: MaybeBlock } | null | undefined)?.root;
  const children = root?.children;
  if (!Array.isArray(children)) return "";
  return blocksToMarkdown(children as LexicalBlocks);
}
