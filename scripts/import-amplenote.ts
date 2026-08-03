/**
 * One-off Amplenote markdown-export importer.
 *
 * Reads an Amplenote export directory (default ~/Downloads/notes: *.md files
 * with YAML frontmatter, plus images/ and attachments/) and imports it into
 * the app's database for the OWNER account.
 *
 * Rules this script enforces:
 * - Content fidelity: faithful markdown -> Lexical conversion; unknown or
 *   exotic markdown (tables, footnotes) is preserved as plain text, never
 *   dropped.
 * - Inserts only, all owner-scoped. The single exception is the daily-note
 *   append-merge: when an imported daily's date already has a live daily note
 *   in the DB, the imported blocks are APPENDED to that note (content +
 *   text_content mirror + updated_at only), below a horizontal rule and a
 *   "— imported from Amplenote —" marker paragraph. The marker doubles as the
 *   idempotency check so the append can never run twice.
 * - Idempotent: every generated row id is uuid v5 of a stable name under a
 *   fixed namespace, and every insert is ON CONFLICT DO NOTHING, so re-runs
 *   create zero duplicates and report what they skipped.
 *
 * Modes:
 *   npx tsx scripts/import-amplenote.ts            # DRY RUN (default): writes
 *                                                  # nothing, prints the plan
 *   npx tsx scripts/import-amplenote.ts --apply    # perform the import
 *   optional: --dir=/path/to/export
 *
 * Requires DATABASE_URL in .env.local (read via dotenv, like scripts/migrate).
 * Image bytes follow the app's db storage driver path exactly (the production
 * default): upload_blobs row + attachments row + URL /api/uploads/<blobId> —
 * see src/app/api/uploads/route.ts and src/lib/storage/db.ts.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { config } from "dotenv";

import { formatUtcDate } from "../src/lib/dates";
import { lexicalToPlainText } from "../src/lib/lexical-text";
import type { SerializedEditorState } from "lexical";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The REAL account. Never touch any other owner's rows. */
const OWNER = "user_368szVRdV9GLCaCol5TQ8e8XIuy";

/** Fixed uuid-v5 namespace for every deterministic id this script mints. */
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 DNS ns, fine as a fixed constant

/** Marker paragraph inserted exactly once when appending into an existing daily. */
const MERGE_MARKER = "— imported from Amplenote —";

/** Mirrors TEXT_MIRROR_MAX in src/server/notes.ts. */
const TEXT_MIRROR_MAX = 20_000;

/** /api/uploads caps uploads at 3 MB; larger images are imported but flagged. */
const UPLOAD_SOFT_CAP = 3 * 1024 * 1024;

const APPLY = process.argv.includes("--apply");
const DIR_ARG = process.argv.find((a) => a.startsWith("--dir="));
const EXPORT_DIR = DIR_ARG
  ? DIR_ARG.slice("--dir=".length)
  : path.join(os.homedir(), "Downloads", "notes");

/** Top-level tag segment -> folder title (existing or to create). */
const TOP_LEVEL_FOLDER: Record<string, string> = {
  "1-projects": "Projects",
  work: "work",
  "2-areas": "Areas",
  "3-resources": "Resources",
  general: "General",
};

/** Tag path segment that maps to the existing "Notarium" folder. */
const NOTES_APP_SEGMENT = "notes-app";
const NOTES_APP_FOLDER_TITLE = "Notarium";

// ---------------------------------------------------------------------------
// uuid v5 (SHA-1, RFC 4122) — no dependency needed
// ---------------------------------------------------------------------------

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(b: Buffer): string {
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function uuidv5(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([uuidToBytes(NAMESPACE), Buffer.from(name, "utf8")]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

// ---------------------------------------------------------------------------
// Serialized Lexical node builders (exact shapes the editor round-trips; see
// scripts/seed-dummy.ts and src/lib/lexical-build.ts)
// ---------------------------------------------------------------------------

type SerNode = Record<string, unknown>;

interface Fmt {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

function fmtBits(f: Fmt): number {
  let bits = 0;
  if (f.bold) bits |= 1;
  if (f.italic) bits |= 2;
  if (f.strike) bits |= 4;
  if (f.code) bits |= 16;
  return bits;
}

function textNode(text: string, f: Fmt = {}): SerNode {
  return {
    detail: 0,
    format: fmtBits(f),
    mode: "normal",
    style: "",
    text,
    type: "text",
    version: 1,
  };
}

const lineBreak = (): SerNode => ({ type: "linebreak", version: 1 });

function el(type: string, children: SerNode[], extra: SerNode = {}): SerNode {
  return {
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    type,
    version: 1,
    ...extra,
  };
}

const paragraphNode = (children: SerNode[]): SerNode =>
  el("paragraph", children, { textFormat: 0, textStyle: "" });
const headingNode = (children: SerNode[], tag: "h1" | "h2" | "h3"): SerNode =>
  el("heading", children, { tag });
const quoteNode = (children: SerNode[]): SerNode => el("quote", children);
const codeNode = (code: string, language: string): SerNode =>
  el("code", [textNode(code)], { language });
const hrNode = (): SerNode => ({ type: "horizontalrule", version: 1 });
const linkNode = (url: string, children: SerNode[]): SerNode =>
  el("link", children, { rel: null, target: null, title: null, url });
const noteLinkNode = (noteId: string, title: string): SerNode => ({
  type: "note-link",
  version: 1,
  noteId,
  title,
});
const imageSerNode = (
  src: string,
  altText: string,
  naturalWidth: number | null,
  inline: boolean,
): SerNode => ({
  type: "image",
  version: 1,
  src,
  altText,
  naturalWidth,
  inline,
});
const taskSerNode = (taskId: string, title: string): SerNode => ({
  type: "task",
  version: 1,
  taskId,
  title,
  completed: false,
  dueAt: null,
});

function rootDoc(children: SerNode[]): SerNode {
  return { root: el("root", children, {}) };
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (the tiny YAML subset Amplenote emits)
// ---------------------------------------------------------------------------

interface FrontMatter {
  title: string | null;
  uuid: string | null;
  created: Date | null;
  updated: Date | null;
  tags: string[];
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // YAML double-quoted scalar: decode escapes (Amplenote emits emoji titles
    // as \U0001F4EB-style unicode escapes).
    return t
      .slice(1, -1)
      .replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return t;
}

function parseFrontmatter(src: string): { meta: FrontMatter; body: string } {
  const meta: FrontMatter = {
    title: null,
    uuid: null,
    created: null,
    updated: null,
    tags: [],
  };
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta, body: src };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { meta, body: src };

  let listKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && listKey === "tags") {
      meta.tags.push(unquote(listMatch[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    const val = rawVal.trim();
    if (val === "") {
      listKey = key; // block start (tags:, storage:)
      continue;
    }
    listKey = null;
    if (key === "title") meta.title = unquote(val);
    else if (key === "uuid") meta.uuid = unquote(val);
    else if (key === "created") meta.created = new Date(unquote(val));
    else if (key === "updated") meta.updated = new Date(unquote(val));
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

// ---------------------------------------------------------------------------
// Daily-note title detection
// ---------------------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAILY_TITLE_RE = new RegExp(
  `^(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th),\\s+(\\d{4})$`,
);

function dailyDateFromTitle(title: string): string | null {
  const m = title.trim().match(DAILY_TITLE_RE);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The app's daily title, mirroring dailyTitleFromString in src/server/notes.ts. */
function appDailyTitle(dateStr: string): string {
  return formatUtcDate(dateStr, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Inline markdown parsing
// ---------------------------------------------------------------------------

interface NoteRef {
  id: string;
  title: string;
}

interface InlineCtx {
  /** decoded export filename ("Work Journal.md") -> imported note */
  fileToNote: Map<string, NoteRef>;
  /** amplenote note uuid -> imported note (for amplenote.com deep links) */
  uuidToNote: Map<string, NoteRef>;
  onNoteLink: (targetId: string) => void;
  onUnresolvedNoteLink: (fileName: string) => void;
  onImage: (relPath: string) => { src: string } | null;
  onAttachment: (relPath: string, label: string) => void;
}

const PUNCT_RE = /[!-/:-@[-`{-~]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

function decodeUrl(u: string): string {
  let decoded = u;
  try {
    decoded = decodeURIComponent(u);
  } catch {
    /* keep raw */
  }
  // Amplenote backslash-escapes markdown punctuation inside link targets
  // (e.g. "Notes App \(dev project\).md") — unescape so file lookups match.
  return decoded.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/** Find `close` starting at `from`; returns -1 when absent. */
function findSeq(src: string, close: string, from: number): number {
  return src.indexOf(close, from);
}

/** Match "[label](url)" starting at src[start] === "[". Returns null if not a link. */
function matchLink(
  src: string,
  start: number,
): { label: string; url: string; end: number } | null {
  let depth = 0;
  let i = start;
  let labelEnd = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
  }
  if (labelEnd < 0 || src[labelEnd + 1] !== "(") return null;
  let parenDepth = 0;
  for (let j = labelEnd + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === "(") parenDepth++;
    else if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        return {
          label: src.slice(start + 1, labelEnd),
          url: src.slice(labelEnd + 2, j),
          end: j + 1,
        };
      }
    }
  }
  return null;
}

const AMPLENOTE_NOTE_LINK_RE =
  /amplenote\.com\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[?#])/;

function parseImageTarget(
  rawAlt: string,
  url: string,
  inline: boolean,
  ctx: InlineCtx,
): SerNode | null {
  // Amplenote encodes a display width as "alt|700".
  let alt = rawAlt;
  let width: number | null = null;
  const pipe = rawAlt.lastIndexOf("|");
  if (pipe >= 0 && /^\d+$/.test(rawAlt.slice(pipe + 1))) {
    width = Number(rawAlt.slice(pipe + 1));
    alt = rawAlt.slice(0, pipe);
  }
  const decoded = decodeUrl(url);
  if (decoded.startsWith("images/")) {
    const stored = ctx.onImage(decoded);
    if (!stored) return null; // missing file — caller keeps the raw text
    return imageSerNode(stored.src, alt || path.basename(decoded), width, inline);
  }
  if (/^https?:\/\//.test(url)) {
    // Remote image: keep as an image node pointing at the remote URL.
    return imageSerNode(url, alt, width, inline);
  }
  return null;
}

function parseInline(src: string, base: Fmt, ctx: InlineCtx): SerNode[] {
  const out: SerNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      out.push(textNode(buf, base));
      buf = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Backslash escapes (Amplenote escapes markdown punctuation in prose).
    if (ch === "\\" && i + 1 < src.length && PUNCT_RE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Inline code span.
    if (ch === "`") {
      const end = findSeq(src, "`", i + 1);
      if (end > i) {
        flush();
        out.push(textNode(src.slice(i + 1, end), { ...base, code: true }));
        i = end + 1;
        continue;
      }
    }

    // Bold / strike / italic.
    const two = src.slice(i, i + 2);
    if (two === "**" || two === "~~" || two === "__") {
      const end = findSeq(src, two, i + 2);
      if (end > i + 2) {
        flush();
        const inner = src.slice(i + 2, end);
        const f: Fmt =
          two === "~~" ? { ...base, strike: true } : { ...base, bold: true };
        out.push(...parseInline(inner, f, ctx));
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" ) {
      const end = findSeq(src, "*", i + 1);
      if (end > i + 1 && src[i + 1] !== " " && src[end - 1] !== " ") {
        flush();
        out.push(...parseInline(src.slice(i + 1, end), { ...base, italic: true }, ctx));
        i = end + 1;
        continue;
      }
    }
    if (ch === "_" && !isWordChar(src[i - 1])) {
      const end = findSeq(src, "_", i + 1);
      if (end > i + 1 && !isWordChar(src[end + 1])) {
        flush();
        out.push(...parseInline(src.slice(i + 1, end), { ...base, italic: true }, ctx));
        i = end + 1;
        continue;
      }
    }

    // Inline image.
    if (ch === "!" && src[i + 1] === "[") {
      const link = matchLink(src, i + 1);
      if (link) {
        const node = parseImageTarget(link.label, link.url, true, ctx);
        if (node) {
          flush();
          out.push(node);
          i = link.end;
          continue;
        }
      }
    }

    // Links: note links, attachments, plain URLs.
    if (ch === "[") {
      const link = matchLink(src, i);
      if (link) {
        const decoded = decodeUrl(link.url);
        if (decoded.toLowerCase().endsWith(".md") && !decoded.includes("/")) {
          const target = ctx.fileToNote.get(decoded);
          flush();
          if (target) {
            out.push(noteLinkNode(target.id, target.title));
            ctx.onNoteLink(target.id);
          } else {
            // Target absent from the export: keep the link text, no dead link.
            out.push(...parseInline(link.label, base, ctx));
            ctx.onUnresolvedNoteLink(decoded);
          }
          i = link.end;
          continue;
        }
        if (decoded.startsWith("attachments/")) {
          flush();
          ctx.onAttachment(decoded, link.label);
          out.push(...parseInline(link.label, base, ctx));
          i = link.end;
          continue;
        }
        if (/^https?:\/\//.test(link.url)) {
          const amp = link.url.match(AMPLENOTE_NOTE_LINK_RE);
          const target = amp ? ctx.uuidToNote.get(amp[1]) : undefined;
          flush();
          if (target) {
            out.push(noteLinkNode(target.id, target.title));
            ctx.onNoteLink(target.id);
          } else {
            out.push(linkNode(link.url, parseInline(link.label, base, ctx)));
          }
          i = link.end;
          continue;
        }
      }
    }

    // Autolink-style <https://…>.
    if (ch === "<" && /^<https?:\/\//.test(src.slice(i))) {
      const end = findSeq(src, ">", i + 1);
      if (end > i) {
        const url = src.slice(i + 1, end);
        flush();
        out.push(linkNode(url, [textNode(url, base)]));
        i = end + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Force the strikethrough bit onto every text node in a subtree (done-task rows). */
function applyStrike(nodes: SerNode[]): SerNode[] {
  for (const n of nodes) {
    if (n.type === "text" && typeof n.format === "number") {
      n.format = (n.format as number) | 4;
    }
    if (Array.isArray(n.children)) applyStrike(n.children as SerNode[]);
  }
  return nodes;
}

function inlineToPlain(nodes: SerNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n.text === "string") out += n.text;
    else if (n.type === "note-link" && typeof n.title === "string") out += n.title;
    if (Array.isArray(n.children)) out += inlineToPlain(n.children as SerNode[]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block-level markdown -> Lexical conversion
// ---------------------------------------------------------------------------

interface PlannedTask {
  id: string;
  title: string;
  sortOrder: number;
}

interface ConvertOutput {
  blocks: SerNode[];
  tasks: PlannedTask[];
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TASK_LINE_RE = /^(\s*)[-*+] \[( |x|X)\]\s?(.*)$/;
const LIST_LINE_RE = /^(\s*)(?:([-*+])|(\d+)[.)]) (.*)$/;

function convertMarkdown(
  body: string,
  noteUuid: string,
  ctx: InlineCtx,
): ConvertOutput {
  const blocks: SerNode[] = [];
  const tasks: PlannedTask[] = [];
  let taskCounter = 0;

  // Paragraph accumulation: consecutive prose lines become one paragraph with
  // linebreak nodes between lines (preserves Amplenote's soft line breaks).
  let paraLines: string[] = [];
  // Blockquote accumulation.
  let quoteLines: string[] = [];
  // Code fence state.
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  // List stack: nested lists live inside a wrapper listitem of the parent list.
  interface ListLevel {
    node: SerNode;
    indent: number;
    ordered: boolean;
    count: number;
  }
  let listStack: ListLevel[] = [];

  const flushPara = () => {
    if (paraLines.length === 0) return;
    const children: SerNode[] = [];
    paraLines.forEach((line, idx) => {
      if (idx > 0) children.push(lineBreak());
      children.push(...parseInline(line, {}, ctx));
    });
    paraLines = [];
    // A paragraph that is exactly one image renders as a block image.
    if (children.length === 1 && children[0].type === "image") {
      children[0].inline = false;
      blocks.push(children[0]);
      return;
    }
    blocks.push(paragraphNode(children));
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const children: SerNode[] = [];
    quoteLines.forEach((line, idx) => {
      if (idx > 0) children.push(lineBreak());
      children.push(...parseInline(line, {}, ctx));
    });
    quoteLines = [];
    blocks.push(quoteNode(children));
  };

  const flushList = () => {
    if (listStack.length === 0) return;
    blocks.push(listStack[0].node);
    listStack = [];
  };

  const flushAll = () => {
    flushPara();
    flushQuote();
    flushList();
  };

  const listNode = (ordered: boolean): SerNode =>
    el("list", [], {
      listType: ordered ? "number" : "bullet",
      start: 1,
      tag: ordered ? "ol" : "ul",
    });

  const listItemNode = (children: SerNode[], value: number): SerNode =>
    el("listitem", children, { value });

  /** Ensure the list stack matches `indent`/`ordered`; returns the active level. */
  const ensureListLevel = (indent: number, ordered: boolean): ListLevel => {
    flushPara();
    flushQuote();
    while (
      listStack.length > 0 &&
      listStack[listStack.length - 1].indent > indent
    ) {
      listStack.pop();
    }
    const top = listStack[listStack.length - 1];
    if (top && top.indent === indent) {
      if (top.ordered !== ordered && listStack.length === 1) {
        // Sibling list of the other type at the root level: start fresh.
        flushList();
      } else {
        return top;
      }
    }
    const node = listNode(ordered);
    const parent = listStack[listStack.length - 1];
    if (parent) {
      // Nested list lives inside a wrapper listitem of the parent list.
      (parent.node.children as SerNode[]).push(
        listItemNode([node], parent.count + 1),
      );
    }
    const level: ListLevel = { node, indent, ordered, count: 0 };
    listStack.push(level);
    return level;
  };

  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    // Code fences swallow everything verbatim.
    const fence = rawLine.match(/^```(.*)$/);
    if (fence) {
      if (inCode) {
        blocks.push(codeNode(codeLines.join("\n"), codeLang || "plain"));
        inCode = false;
        codeLines = [];
      } else {
        flushAll();
        inCode = true;
        codeLang = fence[1].trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const line = rawLine.replace(/\s+$/, "");

    // Blank line: paragraph/list/quote boundary.
    if (line.trim() === "") {
      flushAll();
      continue;
    }

    // Amplenote's escaped blank paragraph.
    if (line.trim() === "\\") {
      flushAll();
      blocks.push(paragraphNode([]));
      continue;
    }

    // Task / checkbox rows (may sit inside a list).
    const taskMatch = line.match(TASK_LINE_RE);
    if (taskMatch) {
      const [, , box, rest] = taskMatch;
      const commentMatch = rest.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
      let taskUuid: string | null = null;
      if (commentMatch) {
        try {
          const parsed = JSON.parse(commentMatch[1]) as { uuid?: string };
          if (typeof parsed.uuid === "string") taskUuid = parsed.uuid;
        } catch {
          /* malformed metadata — fall back to text-derived id */
        }
      }
      const text = rest.replace(HTML_COMMENT_RE, "").trim();
      if (box === " ") {
        // Open task -> real task row + in-content task node (block-level, so
        // it splits any surrounding list, matching how the app hosts tasks).
        flushAll();
        const title = inlineToPlain(parseInline(text, {}, ctx)).trim() || text;
        const id = uuidv5(
          taskUuid
            ? `task:${taskUuid}`
            : `task:${noteUuid}:${taskCounter}:${title}`,
        );
        taskCounter++;
        tasks.push({ id, title, sortOrder: tasks.length });
        blocks.push(taskSerNode(id, title));
      } else {
        // Completed task -> struck-through bullet row (content, not a task).
        const indent = Math.floor(
          taskMatch[1].replace(/\t/g, "    ").length / 4,
        );
        const level = ensureListLevel(indent, false);
        level.count++;
        (level.node.children as SerNode[]).push(
          listItemNode(applyStrike(parseInline(text, {}, ctx)), level.count),
        );
      }
      continue;
    }

    // Headings (clamped to h3, the deepest the editor renders).
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const depth = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      const text = headingMatch[2].replace(HTML_COMMENT_RE, "").trim();
      blocks.push(headingNode(parseInline(text, {}, ctx), `h${depth}`));
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      flushAll();
      blocks.push(hrNode());
      continue;
    }

    // Blockquote.
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushPara();
      flushList();
      quoteLines.push(quoteMatch[1].replace(HTML_COMMENT_RE, ""));
      continue;
    }

    // Tables: no table nodes in the editor — preserve each row as plain text.
    if (/^\s*\|/.test(line)) {
      flushAll();
      blocks.push(
        paragraphNode(parseInline(line.replace(HTML_COMMENT_RE, ""), {}, ctx)),
      );
      continue;
    }

    // List items.
    const listMatch = line.match(LIST_LINE_RE);
    if (listMatch) {
      const [, ws, bullet, , rest] = listMatch;
      const indent = Math.floor(ws.replace(/\t/g, "    ").length / 4);
      const ordered = !bullet;
      const level = ensureListLevel(indent, ordered);
      level.count++;
      (level.node.children as SerNode[]).push(
        listItemNode(
          parseInline(rest.replace(HTML_COMMENT_RE, ""), {}, ctx),
          level.count,
        ),
      );
      continue;
    }

    // Plain prose line.
    flushQuote();
    flushList();
    paraLines.push(line.replace(HTML_COMMENT_RE, ""));
  }

  if (inCode) {
    // Unterminated fence: keep what we have.
    blocks.push(codeNode(codeLines.join("\n"), codeLang || "plain"));
  }
  flushAll();
  return { blocks, tasks };
}

// ---------------------------------------------------------------------------
// Folder placement
// ---------------------------------------------------------------------------

function prettifySegment(seg: string): string {
  return seg
    .replace(/^\d+-/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface ExistingBubble {
  id: string;
  parentId: string | null;
  title: string;
  isFolder: boolean;
  sortOrder: number;
}

interface PlannedFolder {
  id: string;
  parentId: string;
  title: string;
  sortOrder: number;
  pathLabel: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ParsedFile {
  file: string;
  title: string;
  uuid: string;
  created: Date;
  updated: Date;
  tags: string[];
  body: string;
  bytes: number;
  dailyDate: string | null;
}

interface NotePlan {
  id: string;
  title: string;
  dailyDate: string | null;
  bubbleId: string | null;
  folderLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  blocks: SerNode[];
  tasks: PlannedTask[];
  linkTargets: Set<string>;
  sourceFiles: string[];
  bytes: number;
}

async function main() {
  console.log(`Amplenote import — ${APPLY ? "APPLY" : "DRY RUN"} mode`);
  console.log(`Export dir: ${EXPORT_DIR}`);
  console.log(`Owner:      ${OWNER}\n`);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (expected in .env.local).");
  }

  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { and, eq, inArray, isNull, isNotNull } = await import("drizzle-orm");

  // -------------------------------------------------------------------------
  // 1. Read + parse every export file.
  // -------------------------------------------------------------------------
  const entries = await fs.readdir(EXPORT_DIR, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();

  const parsed: ParsedFile[] = [];
  const parseFailures: { file: string; reason: string }[] = [];

  for (const file of mdFiles) {
    try {
      const raw = await fs.readFile(path.join(EXPORT_DIR, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      if (!meta.uuid) {
        parseFailures.push({ file, reason: "no uuid in frontmatter" });
        continue;
      }
      const title = meta.title?.trim() || "Untitled";
      parsed.push({
        file,
        title,
        uuid: meta.uuid,
        created: meta.created ?? new Date(),
        updated: meta.updated ?? meta.created ?? new Date(),
        tags: meta.tags,
        body,
        bytes: Buffer.byteLength(raw),
        dailyDate: dailyDateFromTitle(title),
      });
    } catch (err) {
      parseFailures.push({ file, reason: String(err) });
    }
  }

  const dailies = parsed.filter((p) => p.dailyDate !== null);
  const regulars = parsed.filter((p) => p.dailyDate === null);

  // -------------------------------------------------------------------------
  // 2. Load existing DB state (all reads owner-scoped).
  // -------------------------------------------------------------------------
  const existingBubbles: ExistingBubble[] = await db
    .select({
      id: schema.bubbles.id,
      parentId: schema.bubbles.parentId,
      title: schema.bubbles.title,
      isFolder: schema.bubbles.isFolder,
      sortOrder: schema.bubbles.sortOrder,
    })
    .from(schema.bubbles)
    .where(eq(schema.bubbles.ownerId, OWNER));

  const root = existingBubbles.find((b) => b.parentId === null);
  if (!root) {
    throw new Error(`No root bubble found for owner ${OWNER} — aborting.`);
  }

  // Fetch ALL owner dailies and key by date STRING — matching by timestamp
  // equality is a trap (stored values vary in wall-clock offset vs the
  // midnight-UTC convention this script writes, which made prior-run imports
  // invisible/inconsistently visible on re-runs).
  const existingDailyRows = await db
    .select()
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.ownerId, OWNER),
        isNull(schema.notes.deletedAt),
        isNotNull(schema.notes.dailyDate),
      ),
    );
  const existingDailyByDate = new Map(
    existingDailyRows.map((n) => [
      (n.dailyDate as Date).toISOString().slice(0, 10),
      n,
    ]),
  );

  // -------------------------------------------------------------------------
  // 3. Pre-assign every note id + build the link-resolution maps.
  // -------------------------------------------------------------------------
  const fileToNote = new Map<string, NoteRef>();
  const uuidToNote = new Map<string, NoteRef>();

  // Daily groups: all files for one date collapse into one note.
  const dailyGroups = new Map<string, ParsedFile[]>();
  for (const d of dailies) {
    const key = d.dailyDate as string;
    const group = dailyGroups.get(key) ?? [];
    group.push(d);
    dailyGroups.set(key, group);
  }
  for (const group of dailyGroups.values()) {
    group.sort((a, b) => a.created.getTime() - b.created.getTime());
  }

  for (const [date, group] of dailyGroups) {
    const existing = existingDailyByDate.get(date);
    const ref: NoteRef = existing
      ? { id: existing.id, title: existing.title }
      : { id: uuidv5(`daily:${date}`), title: appDailyTitle(date) };
    for (const f of group) {
      fileToNote.set(f.file, ref);
      uuidToNote.set(f.uuid, ref);
    }
  }
  for (const r of regulars) {
    const ref: NoteRef = { id: uuidv5(`note:${r.uuid}`), title: r.title };
    fileToNote.set(r.file, ref);
    uuidToNote.set(r.uuid, ref);
  }

  // -------------------------------------------------------------------------
  // 4. Folder resolution (lookup-or-plan, case-insensitive on (parent, title)).
  // -------------------------------------------------------------------------
  const plannedFolders: PlannedFolder[] = [];
  const childIndex = new Map<string, ExistingBubble[]>();
  for (const b of existingBubbles) {
    if (!b.parentId) continue;
    const list = childIndex.get(b.parentId) ?? [];
    list.push(b);
    childIndex.set(b.parentId, list);
  }
  const nextSort = new Map<string, number>();
  const siblingMax = (parentId: string) =>
    Math.max(0, ...(childIndex.get(parentId) ?? []).map((b) => b.sortOrder));

  const findOrPlanFolder = (
    parentId: string,
    title: string,
    pathLabel: string,
  ): string => {
    const lower = title.toLowerCase();
    const existing = (childIndex.get(parentId) ?? []).find(
      (b) => b.title.toLowerCase() === lower,
    );
    if (existing) return existing.id;
    const planned = plannedFolders.find(
      (f) => f.parentId === parentId && f.title.toLowerCase() === lower,
    );
    if (planned) return planned.id;
    const sort = (nextSort.get(parentId) ?? siblingMax(parentId)) + 1;
    nextSort.set(parentId, sort);
    const folder: PlannedFolder = {
      id: uuidv5(`folder:${parentId}:${lower}`),
      parentId,
      title,
      sortOrder: sort,
      pathLabel,
    };
    plannedFolders.push(folder);
    return folder.id;
  };

  const notarium = existingBubbles.find(
    (b) => b.title.toLowerCase() === NOTES_APP_FOLDER_TITLE.toLowerCase(),
  );

  const folderWarnings: string[] = [];
  const resolveFolderForTag = (
    tagPath: string,
  ): { bubbleId: string; label: string } => {
    const segs = tagPath.split("/").filter(Boolean);
    const topSeg = segs[0];
    const topTitle = TOP_LEVEL_FOLDER[topSeg] ?? prettifySegment(topSeg);
    let currentId = findOrPlanFolder(root.id, topTitle, topTitle);
    let label = topTitle;
    for (const seg of segs.slice(1)) {
      if (seg === NOTES_APP_SEGMENT) {
        if (notarium) {
          currentId = notarium.id;
          label = NOTES_APP_FOLDER_TITLE;
          continue;
        }
        folderWarnings.push(
          `"${NOTES_APP_FOLDER_TITLE}" folder not found — tag segment "${NOTES_APP_SEGMENT}" falls back to a new subfolder`,
        );
      }
      const title = prettifySegment(seg);
      label = `${label} > ${title}`;
      currentId = findOrPlanFolder(currentId, title, label);
    }
    return { bubbleId: currentId, label };
  };

  // -------------------------------------------------------------------------
  // 5. Convert every note body -> Lexical, collecting tasks/links/images.
  // -------------------------------------------------------------------------
  const imageRefs = new Map<
    string,
    { blobId: string; size: number; mime: string; missing: boolean }
  >();
  const leftBehind = new Map<string, Set<string>>(); // attachment path -> note titles
  const unresolvedLinks = new Map<string, Set<string>>(); // missing file -> referencing notes
  let resolvedLinkCount = 0;

  const mimeFromExt = (p: string): string => {
    switch (path.extname(p).toLowerCase()) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".svg":
        return "image/svg+xml";
      case ".heic":
        return "image/heic";
      default:
        return "application/octet-stream";
    }
  };

  const makeCtx = (noteTitle: string, linkTargets: Set<string>): InlineCtx => ({
    fileToNote,
    uuidToNote,
    onNoteLink: (targetId) => {
      linkTargets.add(targetId);
      resolvedLinkCount++;
    },
    onUnresolvedNoteLink: (fileName) => {
      const set = unresolvedLinks.get(fileName) ?? new Set();
      set.add(noteTitle);
      unresolvedLinks.set(fileName, set);
    },
    onImage: (relPath) => {
      let entry = imageRefs.get(relPath);
      if (!entry) {
        entry = {
          blobId: uuidv5(`image:${relPath}`),
          size: 0,
          mime: mimeFromExt(relPath),
          missing: false,
        };
        imageRefs.set(relPath, entry);
      }
      return { src: `/api/uploads/${entry.blobId}` };
    },
    onAttachment: (relPath, _label) => {
      const set = leftBehind.get(relPath) ?? new Set();
      set.add(noteTitle);
      leftBehind.set(relPath, set);
    },
  });

  const plans: NotePlan[] = [];

  // Regular notes.
  for (const r of regulars) {
    const ref = fileToNote.get(r.file);
    if (!ref) continue;
    const linkTargets = new Set<string>();
    const { blocks, tasks } = convertMarkdown(
      r.body,
      r.uuid,
      makeCtx(r.title, linkTargets),
    );
    let bubbleId: string | null = null;
    let folderLabel: string | null = null;
    if (r.tags.length > 0) {
      const resolved = resolveFolderForTag(r.tags[0]);
      bubbleId = resolved.bubbleId;
      folderLabel = resolved.label;
    }
    linkTargets.delete(ref.id);
    plans.push({
      id: ref.id,
      title: r.title,
      dailyDate: null,
      bubbleId,
      folderLabel,
      createdAt: r.created,
      updatedAt: r.updated,
      blocks,
      tasks,
      linkTargets,
      sourceFiles: [r.file],
      bytes: r.bytes,
    });
  }

  // Daily notes (grouped by date; multi-file groups concatenate with HRs).
  const dailyMerges: {
    plan: NotePlan;
    existingNote: (typeof existingDailyRows)[number];
    alreadyMerged: boolean;
  }[] = [];
  const dailyRepairs: {
    plan: NotePlan;
    existingNote: (typeof existingDailyRows)[number];
  }[] = [];
  let alreadyImportedDailies = 0;

  for (const [date, group] of dailyGroups) {
    const ref = fileToNote.get(group[0].file);
    if (!ref) continue;
    const linkTargets = new Set<string>();
    const blocks: SerNode[] = [];
    const tasks: PlannedTask[] = [];
    for (let gi = 0; gi < group.length; gi++) {
      const f = group[gi];
      if (gi > 0) blocks.push(hrNode());
      const out = convertMarkdown(f.body, f.uuid, makeCtx(ref.title, linkTargets));
      blocks.push(...out.blocks);
      for (const t of out.tasks) {
        tasks.push({ ...t, sortOrder: tasks.length });
      }
    }
    linkTargets.delete(ref.id);
    const created = group[0].created;
    const updated = new Date(
      Math.max(...group.map((f) => f.updated.getTime())),
    );
    const plan: NotePlan = {
      id: ref.id,
      title: ref.title,
      dailyDate: date,
      bubbleId: null,
      folderLabel: null,
      createdAt: created,
      updatedAt: updated,
      blocks,
      tasks,
      linkTargets,
      sourceFiles: group.map((f) => f.file),
      bytes: group.reduce((a, f) => a + f.bytes, 0),
    };
    const existingNote = existingDailyByDate.get(date);
    if (existingNote && existingNote.id === plan.id) {
      // A prior run of THIS import created it. Never merge a note into
      // itself. If a buggy earlier run did (marker present in one of our own
      // rows), queue a repair: regenerate the content from source.
      const damaged = JSON.stringify(existingNote.content ?? {}).includes(
        MERGE_MARKER,
      );
      if (damaged) dailyRepairs.push({ plan, existingNote });
      else alreadyImportedDailies++;
    } else if (existingNote) {
      const alreadyMerged = JSON.stringify(existingNote.content ?? {}).includes(
        MERGE_MARKER,
      );
      dailyMerges.push({ plan, existingNote, alreadyMerged });
    } else {
      plans.push(plan);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Measure images + query existing rows for idempotency accounting.
  // -------------------------------------------------------------------------
  for (const [relPath, entry] of imageRefs) {
    try {
      const st = await fs.stat(path.join(EXPORT_DIR, relPath));
      entry.size = st.size;
    } catch {
      entry.missing = true;
    }
  }

  const plannedNoteIds = plans.map((p) => p.id);
  const existingNoteIds = new Set(
    plannedNoteIds.length > 0
      ? (
          await db
            .select({ id: schema.notes.id })
            .from(schema.notes)
            .where(
              and(
                eq(schema.notes.ownerId, OWNER),
                inArray(schema.notes.id, plannedNoteIds),
              ),
            )
        ).map((r) => r.id)
      : [],
  );

  const allTaskIds = [
    ...new Set(
      [...plans, ...dailyMerges.map((m) => m.plan)].flatMap((p) =>
        p.tasks.map((t) => t.id),
      ),
    ),
  ];
  const existingTaskIds = new Set(
    allTaskIds.length > 0
      ? (
          await db
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.ownerId, OWNER),
                inArray(schema.tasks.id, allTaskIds),
              ),
            )
        ).map((r) => r.id)
      : [],
  );

  const allBlobIds = [...imageRefs.values()].map((i) => i.blobId);
  const existingBlobIds = new Set(
    allBlobIds.length > 0
      ? (
          await db
            .select({ id: schema.uploadBlobs.id })
            .from(schema.uploadBlobs)
            .where(
              and(
                eq(schema.uploadBlobs.ownerId, OWNER),
                inArray(schema.uploadBlobs.id, allBlobIds),
              ),
            )
        ).map((r) => r.id)
      : [],
  );

  // -------------------------------------------------------------------------
  // 7. Report (dry run) / execute (apply).
  // -------------------------------------------------------------------------
  const newPlans = plans.filter((p) => !existingNoteIds.has(p.id));
  const skippedPlans = plans.filter((p) => existingNoteIds.has(p.id));
  const newDailyPlans = newPlans.filter((p) => p.dailyDate !== null);
  const newRegularPlans = newPlans.filter((p) => p.dailyDate === null);
  const pendingMerges = dailyMerges.filter((m) => !m.alreadyMerged);
  const skippedMerges = dailyMerges.filter((m) => m.alreadyMerged);

  const allPlansForTasks = [...plans, ...dailyMerges.map((m) => m.plan)];
  const uniqueNewTasks = new Map<string, PlannedTask>();
  for (const p of allPlansForTasks) {
    for (const t of p.tasks) {
      if (!existingTaskIds.has(t.id)) uniqueNewTasks.set(t.id, t);
    }
  }

  const newImages = [...imageRefs.entries()].filter(
    ([, i]) => !existingBlobIds.has(i.blobId) && !i.missing,
  );
  const totalImageBytes = newImages.reduce((a, [, i]) => a + i.size, 0);
  const oversized = [...imageRefs.entries()].filter(
    ([, i]) => i.size > UPLOAD_SOFT_CAP,
  );
  const missingImages = [...imageRefs.entries()].filter(([, i]) => i.missing);

  const linkPairs = new Set<string>();
  for (const p of allPlansForTasks) {
    for (const target of p.linkTargets) linkPairs.add(`${p.id}::${target}`);
  }

  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

  console.log("=== Files ===");
  console.log(`  parsed: ${parsed.length} (${regulars.length} regular, ${dailies.length} daily across ${dailyGroups.size} dates)`);
  if (parseFailures.length > 0) {
    console.log(`  FAILED TO PARSE: ${parseFailures.length}`);
    for (const f of parseFailures) console.log(`    - ${f.file}: ${f.reason}`);
  } else {
    console.log("  failed to parse: none");
  }

  console.log("\n=== Notes ===");
  console.log(`  regular notes to create: ${newRegularPlans.length}`);
  console.log(`  daily notes to create:   ${newDailyPlans.length}`);
  const multiFileDates = [...dailyGroups.entries()].filter(([, g]) => g.length > 1);
  console.log(`  daily dates merged from multiple files: ${multiFileDates.length} (${multiFileDates.map(([d, g]) => `${d}×${g.length}`).join(", ")})`);
  console.log(`  skipped (already imported): ${skippedPlans.length}`);
  console.log(`  unfiled regular notes (no tags): ${newRegularPlans.filter((p) => p.bubbleId === null).length}`);

  console.log("\n=== Daily-date collisions with existing dailies ===");
  if (dailyMerges.length === 0) {
    console.log("  none");
  } else {
    for (const m of dailyMerges) {
      console.log(
        `  ${m.plan.dailyDate}: existing note "${m.existingNote.title}" (${m.existingNote.id}) <- append from ${m.plan.sourceFiles.join(" + ")}${m.alreadyMerged ? "  [SKIP: already merged]" : ""}`,
      );
    }
  }

  console.log("\n=== Folder tree (existing + [NEW]) ===");
  const printTree = (parentId: string, prefix: string) => {
    const existing = (childIndex.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const plannedHere = plannedFolders.filter((f) => f.parentId === parentId);
    for (const b of existing) {
      const noteCount = newRegularPlans.filter((p) => p.bubbleId === b.id).length;
      const touched =
        noteCount > 0 ||
        plannedFolders.some((f) => f.parentId === b.id) ||
        b.parentId === root.id;
      if (!touched) continue;
      console.log(
        `${prefix}${b.title}${b.isFolder ? "" : " (bubble)"}${noteCount > 0 ? `  <- ${noteCount} note${noteCount === 1 ? "" : "s"}` : ""}`,
      );
      printTree(b.id, prefix + "  ");
    }
    for (const f of plannedHere) {
      const noteCount = newRegularPlans.filter((p) => p.bubbleId === f.id).length;
      console.log(
        `${prefix}[NEW] ${f.title}${noteCount > 0 ? `  <- ${noteCount} note${noteCount === 1 ? "" : "s"}` : ""}`,
      );
      printTree(f.id, prefix + "  ");
    }
  };
  console.log(`${root.title} (root)`);
  printTree(root.id, "  ");
  console.log(`  folders to create: ${plannedFolders.length}`);
  for (const w of [...new Set(folderWarnings)]) console.log(`  WARNING: ${w}`);

  console.log("\n=== Tasks ===");
  console.log(`  open tasks to create: ${uniqueNewTasks.size}`);
  console.log(`  already imported (skipped): ${allTaskIds.length - uniqueNewTasks.size}`);

  console.log("\n=== Images ===");
  console.log(`  referenced: ${imageRefs.size} unique`);
  console.log(`  to upload: ${newImages.length} (${mb(totalImageBytes)} MB)`);
  console.log(`  already uploaded (skipped): ${existingBlobIds.size}`);
  if (oversized.length > 0) {
    console.log(`  over the app's 3 MB upload cap (imported anyway, flagged): ${oversized.length}`);
    for (const [p, i] of oversized.slice(0, 15)) console.log(`    - ${p} (${mb(i.size)} MB)`);
  }
  if (missingImages.length > 0) {
    console.log(`  MISSING FILES: ${missingImages.length}`);
    for (const [p] of missingImages) console.log(`    - ${p}`);
  }

  console.log("\n=== Note links ===");
  console.log(`  resolved to note-link nodes: ${resolvedLinkCount} (${linkPairs.size} unique note_links rows)`);
  const unresolvedTotal = [...unresolvedLinks.values()].reduce((a, s) => a + s.size, 0);
  console.log(`  kept as plain text (target not in export): ${unresolvedLinks.size} targets, referenced from ${unresolvedTotal} notes`);
  for (const [file, refs] of unresolvedLinks) {
    console.log(`    - "${file}" (from: ${[...refs].slice(0, 3).join(", ")}${refs.size > 3 ? ", …" : ""})`);
  }

  console.log("\n=== Attachments left behind (NOT imported) ===");
  if (leftBehind.size === 0) console.log("  none referenced");
  for (const [p, notes] of leftBehind) {
    console.log(`  - ${p}  (referenced by: ${[...notes].join(", ")})`);
  }

  console.log("\n=== 10 largest notes ===");
  const largest = [...plans, ...dailyMerges.map((m) => m.plan)]
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  for (const p of largest) {
    console.log(`  ${(p.bytes / 1024).toFixed(1).padStart(7)} KB  ${p.title}${p.dailyDate ? ` (daily ${p.dailyDate})` : ""}`);
  }

  // Debug aid: --dump="<title>" prints a converted note's serialized state.
  const dumpArg = process.argv.find((a) => a.startsWith("--dump="));
  if (dumpArg) {
    const want = dumpArg.slice("--dump=".length).toLowerCase();
    const hit = allPlansForTasks.find((p) => p.title.toLowerCase() === want);
    if (hit) {
      console.log(`\n=== Dump: ${hit.title} ===`);
      console.log(JSON.stringify(rootDoc(hit.blocks), null, 2));
    } else {
      console.log(`\n(no planned note titled "${want}")`);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to import.");
    return;
  }

  // -------------------------------------------------------------------------
  // 8. APPLY.
  // -------------------------------------------------------------------------
  console.log("\nApplying…");

  // Folders (parents before children: planned array is naturally in
  // discovery order, parents pushed before descendants).
  for (const f of plannedFolders) {
    await db
      .insert(schema.bubbles)
      .values({
        id: f.id,
        ownerId: OWNER,
        parentId: f.parentId,
        title: f.title,
        isFolder: true,
        sortOrder: f.sortOrder,
      })
      .onConflictDoNothing();
  }
  console.log(`  folders: ${plannedFolders.length}`);

  // Image blobs + attachments rows (the db storage driver's exact shape).
  let uploaded = 0;
  for (const [relPath, entry] of imageRefs) {
    if (entry.missing || existingBlobIds.has(entry.blobId)) continue;
    const bytes = await fs.readFile(path.join(EXPORT_DIR, relPath));
    await db
      .insert(schema.uploadBlobs)
      .values({
        id: entry.blobId,
        ownerId: OWNER,
        mimeType: entry.mime,
        dataBase64: bytes.toString("base64"),
      })
      .onConflictDoNothing();
    await db
      .insert(schema.attachments)
      .values({
        id: uuidv5(`attachment:${relPath}`),
        ownerId: OWNER,
        kind: "image",
        storageKey: entry.blobId,
        url: `/api/uploads/${entry.blobId}`,
        mimeType: entry.mime,
        fileName: path.basename(relPath),
        sizeBytes: entry.size,
      })
      .onConflictDoNothing();
    uploaded++;
    if (uploaded % 25 === 0) console.log(`  images: ${uploaded}/${newImages.length}…`);
  }
  console.log(`  images: ${uploaded}`);

  // Notes.
  let insertedNotes = 0;
  for (const p of newPlans) {
    const content = rootDoc(p.blocks);
    await db
      .insert(schema.notes)
      .values({
        id: p.id,
        ownerId: OWNER,
        title: p.title,
        content,
        textContent: lexicalToPlainText(
          content as unknown as SerializedEditorState,
          TEXT_MIRROR_MAX,
        ),
        bubbleId: p.bubbleId,
        dailyDate: p.dailyDate ? new Date(`${p.dailyDate}T00:00:00.000Z`) : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })
      .onConflictDoNothing();
    insertedNotes++;
    if (insertedNotes % 50 === 0)
      console.log(`  notes: ${insertedNotes}/${newPlans.length}…`);
  }
  console.log(`  notes: ${insertedNotes}`);

  // Tasks (created_at from the note that carries them).
  const taskCreatedAt = new Map<string, Date>();
  for (const p of allPlansForTasks) {
    for (const t of p.tasks) {
      if (!taskCreatedAt.has(t.id)) taskCreatedAt.set(t.id, p.createdAt);
    }
  }
  for (const t of uniqueNewTasks.values()) {
    await db
      .insert(schema.tasks)
      .values({
        id: t.id,
        ownerId: OWNER,
        title: t.title,
        createdAt: taskCreatedAt.get(t.id) ?? new Date(),
      })
      .onConflictDoNothing();
  }
  console.log(`  tasks: ${uniqueNewTasks.size}`);

  // note_tasks links.
  let noteTaskRows = 0;
  for (const p of allPlansForTasks) {
    for (const t of p.tasks) {
      await db
        .insert(schema.noteTasks)
        .values({ noteId: p.id, taskId: t.id, sortOrder: t.sortOrder })
        .onConflictDoNothing();
      noteTaskRows++;
    }
  }
  console.log(`  note_tasks: ${noteTaskRows}`);

  // note_links rows.
  let linkRows = 0;
  for (const pair of linkPairs) {
    const [sourceNoteId, targetNoteId] = pair.split("::");
    await db
      .insert(schema.noteLinks)
      .values({ sourceNoteId, targetNoteId })
      .onConflictDoNothing();
    linkRows++;
  }
  console.log(`  note_links: ${linkRows}`);

  // Daily append-merges (the single permitted UPDATE; marker-guarded).
  for (const m of pendingMerges) {
    const existingContent = (m.existingNote.content ?? rootDoc([])) as {
      root: { children: SerNode[] };
    };
    if (JSON.stringify(existingContent).includes(MERGE_MARKER)) continue; // re-check
    const mergedChildren = [
      ...(existingContent.root.children ?? []),
      hrNode(),
      paragraphNode([textNode(MERGE_MARKER)]),
      ...m.plan.blocks,
    ];
    const merged = {
      ...existingContent,
      root: { ...existingContent.root, children: mergedChildren },
    };
    await db
      .update(schema.notes)
      .set({
        content: merged,
        textContent: lexicalToPlainText(
          merged as unknown as SerializedEditorState,
          TEXT_MIRROR_MAX,
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.notes.id, m.existingNote.id),
          eq(schema.notes.ownerId, OWNER),
        ),
      );
    console.log(`  merged into existing daily ${m.plan.dailyDate}`);
  }
  if (skippedMerges.length > 0) {
    console.log(`  daily merges skipped (marker already present): ${skippedMerges.length}`);
  }
  if (alreadyImportedDailies > 0) {
    console.log(`  dailies already imported (skipped): ${alreadyImportedDailies}`);
  }

  // Repairs: our own prior-run rows that a buggy merge appended to themselves.
  // Regenerate the content deterministically from source and overwrite.
  for (const r of dailyRepairs) {
    const content = rootDoc(r.plan.blocks);
    await db
      .update(schema.notes)
      .set({
        content,
        textContent: lexicalToPlainText(
          content as unknown as SerializedEditorState,
          TEXT_MIRROR_MAX,
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.notes.id, r.existingNote.id),
          eq(schema.notes.ownerId, OWNER),
        ),
      );
    console.log(`  repaired self-merged daily ${r.plan.dailyDate}`);
  }

  console.log("\n✅ Import complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
