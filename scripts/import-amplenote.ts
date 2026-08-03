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
 *   npx tsx scripts/import-amplenote.ts --verify-html      # harness only
 *   npx tsx scripts/import-amplenote.ts --refresh-unedited # repair mode
 *   npx tsx scripts/import-amplenote.ts --refresh-mirrors  # text_content only
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
/**
 * Repair mode: regenerate content + text_content with the fixed HTML-aware
 * converter for every import-owned note the user has NOT edited since import
 * (db updated_at still equals the imported frontmatter `updated`). Edited
 * notes are skipped and listed. Runs the converter verification first and
 * aborts before any write if it fails.
 */
const REFRESH = process.argv.includes("--refresh-unedited");
/** Run only the converter verification harness (no writes). */
const VERIFY = process.argv.includes("--verify-html");
/**
 * Mirror-only mode: regenerate text_content for EVERY note of the owner from
 * its CURRENT content with the fixed lexicalToPlainText. Never touches
 * content or updated_at, so it is safe for user-edited notes too — the search
 * mirror must reflect whatever the content is now.
 */
const MIRRORS = process.argv.includes("--refresh-mirrors");

/**
 * Machine-stamp window for the refresh gate: an earlier repair run of THIS
 * script bulk-stamped its own dailies' updated_at with `new Date()` inside
 * this 11-second window (verified sequential ~55 ms writes). A daily whose
 * updated_at falls in the window is therefore unedited — a real user edit
 * after the stamp would have moved updated_at past it. On refresh those rows
 * are stamped back to their frontmatter `updated`, so future runs use the
 * strict frontmatter-equality gate again.
 */
const STAMP_WINDOW_START = Date.parse("2026-08-03T01:53:07.000Z");
const STAMP_WINDOW_END = Date.parse("2026-08-03T01:53:18.000Z");
const inStampWindow = (t: number): boolean =>
  t >= STAMP_WINDOW_START && t <= STAMP_WINDOW_END;
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
  underline?: boolean;
  highlight?: boolean;
}

function fmtBits(f: Fmt): number {
  let bits = 0;
  if (f.bold) bits |= 1; // lexical IS_BOLD
  if (f.italic) bits |= 2; // IS_ITALIC
  if (f.strike) bits |= 4; // IS_STRIKETHROUGH
  if (f.underline) bits |= 8; // IS_UNDERLINE
  if (f.code) bits |= 16; // IS_CODE
  if (f.highlight) bits |= 128; // IS_HIGHLIGHT (1 << 7)
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
  /** A known-looking HTML tag was left as literal text (unknown or unclosed). */
  onLiteralHtml?: (tag: string) => void;
}

// ---------------------------------------------------------------------------
// Inline HTML (Amplenote emits literal HTML for highlights and a few basics).
// Only these KNOWN tags are ever transformed, and only in prose context —
// fenced code blocks and inline backtick code are never touched. Anything
// else (unknown tags, unclosed tags) stays literal text and is counted.
// ---------------------------------------------------------------------------

/** Formatting tags -> the Fmt patch OR'd into the surrounding format. */
const HTML_FORMAT_TAGS: Record<string, Fmt> = {
  mark: { highlight: true }, // color itself is not representable; text survives
  b: { bold: true },
  strong: { bold: true },
  i: { italic: true },
  em: { italic: true },
  u: { underline: true },
};

/** Structural wrappers that unwrap to their inner content in prose. */
const HTML_UNWRAP_TAGS = new Set(["span", "div", "p", "center", "label"]);

const HTML_OPEN_RE = /^<([A-Za-z][A-Za-z0-9]*)(\s[^<>]*)?>/;
const HTML_CLOSE_RE = /^<\/([A-Za-z][A-Za-z0-9]*)\s*>/;
const HTML_BR_RE = /^<br\s*\/?\s*>/i;

/**
 * Find the matching close tag for `tag` starting at `from` (which must be just
 * past the open tag), honoring same-tag nesting. Returns null when unclosed.
 */
function findHtmlClose(
  src: string,
  from: number,
  tag: string,
): { start: number; end: number } | null {
  const openRe = new RegExp(`^<${tag}(\\s[^<>]*)?>`, "i");
  const closeRe = new RegExp(`^</${tag}\\s*>`, "i");
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] !== "<") continue;
    const rest = src.slice(i);
    const c = rest.match(closeRe);
    if (c) {
      depth--;
      if (depth === 0) return { start: i, end: i + c[0].length };
      i += c[0].length - 1;
      continue;
    }
    const o = rest.match(openRe);
    if (o) {
      depth++;
      i += o[0].length - 1;
    }
  }
  return null;
}

const HTML_KNOWN_TAGS = new Set([
  ...Object.keys(HTML_FORMAT_TAGS),
  ...HTML_UNWRAP_TAGS,
]);

/**
 * True when every KNOWN html tag inside `seg` is balanced (opens == closes).
 * Markdown emphasis (`*…*`, `**…**`) must not capture a span that cuts a
 * known tag pair in half (e.g. `*<mark>**x**</mark>*` — the first `*` would
 * otherwise pair with a `*` inside the mark and orphan the open tag).
 */
function htmlTagsBalanced(seg: string): boolean {
  const counts = new Map<string, number>();
  const re = /<(\/?)([A-Za-z][A-Za-z0-9]*)(\s[^<>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const tag = m[2].toLowerCase();
    if (!HTML_KNOWN_TAGS.has(tag)) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + (m[1] ? -1 : 1));
  }
  for (const v of counts.values()) if (v !== 0) return false;
  return true;
}

/**
 * Amplenote highlights can span soft line breaks inside one paragraph
 * (`<mark …>first line\` / `second line</mark>`). parseInline works per line,
 * so pre-balance: when a formatting tag opens on a line but closes on a LATER
 * line of the same paragraph, close it at end-of-line and reopen it on the
 * next. Tags that never close in the paragraph are left untouched (literal).
 */
function balanceInlineHtml(lines: string[]): string[] {
  const out: string[] = [];
  let carry: string[] = []; // open-tag source strings reopened on the next line
  const tagScanRe = /<(\/?)([A-Za-z][A-Za-z0-9]*)(\s[^<>]*)?>/g;
  for (let li = 0; li < lines.length; li++) {
    let line = carry.join("") + lines[li];
    carry = [];
    const stack: { tag: string; src: string }[] = [];
    let m: RegExpExecArray | null;
    tagScanRe.lastIndex = 0;
    while ((m = tagScanRe.exec(line))) {
      const tag = m[2].toLowerCase();
      if (!(tag in HTML_FORMAT_TAGS)) continue;
      if (m[1] === "/") {
        if (stack.length > 0 && stack[stack.length - 1].tag === tag) stack.pop();
      } else {
        stack.push({ tag, src: m[0] });
      }
    }
    if (stack.length > 0) {
      const rest = lines.slice(li + 1).join("\n");
      const allCloseLater = stack.every((s) =>
        new RegExp(`</${s.tag}\\s*>`, "i").test(rest),
      );
      if (allCloseLater && li < lines.length - 1) {
        for (let k = stack.length - 1; k >= 0; k--) line += `</${stack[k].tag}>`;
        carry = stack.map((s) => s.src);
      }
    }
    out.push(line);
  }
  return out;
}

const PUNCT_RE = /[!-/:-@[-`{-~]/;

/**
 * Amplenote backslash-escapes markdown punctuation everywhere in the export —
 * including inside code spans and fences, where the escapes are pure export
 * artifacts (Amplenote rendered the unescaped text). Used for the deliberate
 * code-context transform (PART B fix 6).
 */
const ESCAPED_PUNCT_RE = /\\([!-/:-@[-`{-~])/g;
const unescapePunct = (s: string): string => s.replace(ESCAPED_PUNCT_RE, "$1");

/**
 * A trailing UNESCAPED backslash is Amplenote's hard line break. An even run
 * of backslashes is escaped literal backslashes, not a break.
 */
function stripHardBreak(s: string): { text: string; hard: boolean } {
  const m = s.match(/\\+$/);
  if (!m || m[0].length % 2 === 0) return { text: s, hard: false };
  return { text: s.slice(0, -1), hard: true };
}

/**
 * Cross-line `~~strikethrough~~` within one paragraph/list item: pair across
 * soft-break lines, same approach as balanceInlineHtml — when a line leaves a
 * `~~` open and a LATER line of the same block closes it, close at
 * end-of-line and reopen on the next.
 */
function balanceCrossLineStrike(lines: string[]): string[] {
  const out: string[] = [];
  let carry = false;
  for (let li = 0; li < lines.length; li++) {
    let line = (carry ? "~~" : "") + lines[li];
    carry = false;
    const count = (line.match(/~~/g) ?? []).length;
    if (
      count % 2 === 1 &&
      li < lines.length - 1 &&
      lines.slice(li + 1).join("\n").includes("~~")
    ) {
      line += "~~";
      carry = true;
    }
    out.push(line);
  }
  return out;
}

/** Split a markdown table row into trimmed cells, honoring escaped `\|`. */
function splitTableRow(row: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && i + 1 < row.length) {
      cur += ch + row[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // The delimiting outer pipes produce empty edge cells — drop them.
  if (cells.length > 0 && cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

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

/** Schemeless link target that looks like a bare domain ("instantdb.com"). */
const BARE_DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

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

function parseInline(
  src: string,
  base: Fmt,
  ctx: InlineCtx,
  html: boolean,
  /** Unescape export-artifact backslash escapes inside inline code spans. */
  cu = false,
): SerNode[] {
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
        const inner = src.slice(i + 1, end);
        out.push(
          textNode(cu ? unescapePunct(inner) : inner, { ...base, code: true }),
        );
        i = end + 1;
        continue;
      }
    }

    // ***bold italic*** (must run before the ** branch or it leaves stray *).
    if (html && src.slice(i, i + 3) === "***") {
      let end = findSeq(src, "***", i + 3);
      while (html && end > i + 3 && !htmlTagsBalanced(src.slice(i + 3, end))) {
        end = findSeq(src, "***", end + 1);
      }
      if (end > i + 3) {
        flush();
        out.push(
          ...parseInline(
            src.slice(i + 3, end),
            { ...base, bold: true, italic: true },
            ctx,
            html,
            cu,
          ),
        );
        i = end + 3;
        continue;
      }
    }

    // Bold / strike / italic.
    const two = src.slice(i, i + 2);
    if (two === "**" || two === "~~" || two === "__") {
      let end = findSeq(src, two, i + 2);
      while (html && end > i + 2 && !htmlTagsBalanced(src.slice(i + 2, end))) {
        end = findSeq(src, two, end + 2);
      }
      if (end > i + 2) {
        flush();
        const inner = src.slice(i + 2, end);
        const f: Fmt =
          two === "~~" ? { ...base, strike: true } : { ...base, bold: true };
        out.push(...parseInline(inner, f, ctx, html, cu));
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" ) {
      let end = findSeq(src, "*", i + 1);
      while (html && end > i + 1 && !htmlTagsBalanced(src.slice(i + 1, end))) {
        end = findSeq(src, "*", end + 1);
      }
      if (end > i + 1 && src[i + 1] !== " " && src[end - 1] !== " ") {
        flush();
        out.push(...parseInline(src.slice(i + 1, end), { ...base, italic: true }, ctx, html, cu));
        i = end + 1;
        continue;
      }
    }
    if (ch === "_" && !isWordChar(src[i - 1])) {
      let end = findSeq(src, "_", i + 1);
      while (html && end > i + 1 && !htmlTagsBalanced(src.slice(i + 1, end))) {
        end = findSeq(src, "_", end + 1);
      }
      if (end > i + 1 && !isWordChar(src[end + 1])) {
        flush();
        out.push(...parseInline(src.slice(i + 1, end), { ...base, italic: true }, ctx, html, cu));
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
        // local:// images never made it into the export — plain text stand-in
        // (the alt text when present), never raw markdown.
        if (html && link.url.startsWith("local://")) {
          let alt = link.label;
          const pipe = alt.lastIndexOf("|");
          if (pipe >= 0 && /^\d+$/.test(alt.slice(pipe + 1)))
            alt = alt.slice(0, pipe);
          buf += alt.trim() || "(missing image)";
          i = link.end;
          continue;
        }
      }
    }

    // Footnote markers [^n] -> plain "[n]" (definitions are collected at the
    // block level and re-emitted under a trailing "Footnotes" section).
    if (html && ch === "[" && src[i + 1] === "^") {
      const close = src.indexOf("]", i + 2);
      const label = close > i + 2 ? src.slice(i + 2, close) : "";
      if (label && !label.includes(" ") && src[close + 1] !== ":") {
        buf += `[${label}]`;
        i = close + 1;
        continue;
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
            out.push(...parseInline(link.label, base, ctx, html, cu));
            ctx.onUnresolvedNoteLink(decoded);
          }
          i = link.end;
          continue;
        }
        if (decoded.startsWith("attachments/")) {
          flush();
          ctx.onAttachment(decoded, link.label);
          out.push(...parseInline(link.label, base, ctx, html, cu));
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
            out.push(linkNode(link.url, parseInline(link.label, base, ctx, html, cu)));
          }
          i = link.end;
          continue;
        }
        // Empty link [text]() -> just the label text.
        if (html && link.url === "") {
          flush();
          out.push(...parseInline(link.label, base, ctx, html, cu));
          i = link.end;
          continue;
        }
        // Schemeless bare-domain target -> real link with https:// prefixed.
        if (html && BARE_DOMAIN_RE.test(link.url)) {
          flush();
          out.push(
            linkNode(
              `https://${link.url}`,
              parseInline(link.label, base, ctx, html, cu),
            ),
          );
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

    // Inline HTML (prose context only; never reached for code — backtick spans
    // and fenced blocks are consumed before this point / upstream).
    if (html && ch === "<") {
      const rest = src.slice(i);
      const br = rest.match(HTML_BR_RE);
      if (br) {
        flush();
        out.push(lineBreak());
        i += br[0].length;
        continue;
      }
      const open = rest.match(HTML_OPEN_RE);
      if (open) {
        const tag = open[1].toLowerCase();
        const fmtPatch = HTML_FORMAT_TAGS[tag];
        if (fmtPatch || HTML_UNWRAP_TAGS.has(tag)) {
          const close = findHtmlClose(src, i + open[0].length, tag);
          if (close) {
            flush();
            const inner = src.slice(i + open[0].length, close.start);
            out.push(
              ...parseInline(inner, fmtPatch ? { ...base, ...fmtPatch } : base, ctx, html, cu),
            );
            i = close.end;
            continue;
          }
        }
        // Unknown or unclosed tag: stays literal, counted.
        ctx.onLiteralHtml?.(tag);
      } else {
        const closeTag = rest.match(HTML_CLOSE_RE);
        if (closeTag) ctx.onLiteralHtml?.(closeTag[1].toLowerCase());
      }
      // fall through: the "<" is emitted as literal text
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

/**
 * JSON.stringify with recursively sorted object keys. Postgres jsonb does not
 * preserve key order, so comparing regenerated content against a stored row
 * needs an order-independent representation.
 */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Verification helper: bucket every piece of text in a converted block tree
 * into code context (fenced ``` blocks -> "block:…", inline backtick spans ->
 * "inline:…", in document order) vs prose (all other text nodes).
 */
function collectContexts(blocks: SerNode[]): { code: string[]; prose: string[] } {
  const out = { code: [] as string[], prose: [] as string[] };
  const textOf = (n: SerNode): string => {
    let s = "";
    if (typeof n.text === "string") s += n.text;
    if (Array.isArray(n.children))
      for (const c of n.children as SerNode[]) s += textOf(c);
    return s;
  };
  const walk = (n: SerNode) => {
    if (n.type === "code") {
      out.code.push(`block:${textOf(n)}`);
      return;
    }
    if (n.type === "text") {
      const fmt = typeof n.format === "number" ? n.format : 0;
      if (fmt & 16) out.code.push(`inline:${n.text as string}`);
      else out.prose.push(n.text as string);
      return;
    }
    if (Array.isArray(n.children)) for (const c of n.children as SerNode[]) walk(c);
  };
  for (const b of blocks) walk(b);
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

interface ConvertOpts {
  /** Promote indented (list-nested) ``` fences to real code blocks (fix 10). */
  promotePseudo: boolean;
  /** Unescape export-artifact escapes inside code spans/fences (fix 6). */
  codeUnescape: boolean;
}

function convertMarkdown(
  body: string,
  noteUuid: string,
  ctx: InlineCtx,
  /**
   * true (the fixed converter): transform KNOWN inline HTML in prose context
   * and apply the PART B fidelity fixes.
   * false: byte-exact legacy behavior (used by the verification harness).
   */
  htmlMode: boolean,
  /** Verification harness knobs; both default ON in htmlMode. */
  optsIn?: Partial<ConvertOpts>,
): ConvertOutput {
  const opts: ConvertOpts = {
    promotePseudo: htmlMode && (optsIn?.promotePseudo ?? true),
    codeUnescape: htmlMode && (optsIn?.codeUnescape ?? true),
  };
  const cu = opts.codeUnescape;
  const blocks: SerNode[] = [];
  const tasks: PlannedTask[] = [];
  let taskCounter = 0;

  // Paragraph accumulation: consecutive prose lines become one paragraph with
  // linebreak nodes between lines (preserves Amplenote's soft line breaks).
  // Each line carries its own html flag (false inside indented pseudo-fences)
  // and whether it ended with a stripped hard break (trailing `\`).
  let paraLines: { text: string; html: boolean; hard: boolean }[] = [];
  // Blockquote accumulation.
  let quoteLines: { text: string; html: boolean; hard: boolean }[] = [];
  // Code fence state (column-0 fences only — the legacy rule; kept as-is).
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  // INDENTED code fences: with opts.promotePseudo they are promoted to real
  // code blocks (fix 10). Without it (legacy / harness baseline) their content
  // imports as literal prose, but inline-HTML transformation stays OFF inside
  // those regions (the content is real code).
  let pseudoFence = false;
  let indentCode: { indent: string; lang: string; lines: string[] } | null =
    null;
  // Footnote definitions (fix 1): collected and re-emitted at the end under a
  // "Footnotes" heading instead of dumping mid-document.
  const footnotes: { label: string; lines: string[] }[] = [];
  let activeFootnote: { label: string; lines: string[] } | null = null;
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
    const allHtml = paraLines.every((l) => l.html);
    const texts = allHtml
      ? balanceCrossLineStrike(
          balanceInlineHtml(paraLines.map((l) => l.text)),
        )
      : paraLines.map((l) => l.text);
    const lastHard = paraLines[paraLines.length - 1].hard;
    const children: SerNode[] = [];
    texts.forEach((line, idx) => {
      if (idx > 0) children.push(lineBreak());
      children.push(...parseInline(line, {}, ctx, paraLines[idx].html, cu));
    });
    if (lastHard) children.push(lineBreak());
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
    const allHtml = quoteLines.every((l) => l.html);
    const texts = allHtml
      ? balanceCrossLineStrike(
          balanceInlineHtml(quoteLines.map((l) => l.text)),
        )
      : quoteLines.map((l) => l.text);
    const lastHard = quoteLines[quoteLines.length - 1].hard;
    const children: SerNode[] = [];
    texts.forEach((line, idx) => {
      if (idx > 0) children.push(lineBreak());
      children.push(...parseInline(line, {}, ctx, quoteLines[idx].html, cu));
    });
    if (lastHard) children.push(lineBreak());
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

  /**
   * A list/task row whose text ends with a hard break (trailing `\`) continues
   * on the following plain-prose lines — they belong to the SAME item, joined
   * with linebreak nodes (fix 4), which also lets `~~`/<mark> spans that cross
   * those soft breaks pair up (fix 7).
   */
  let pendingItem: {
    level: ListLevel;
    value: number;
    strike: boolean;
    lines: string[];
  } | null = null;

  const finalizePendingItem = () => {
    if (!pendingItem) return;
    const texts = balanceCrossLineStrike(balanceInlineHtml(pendingItem.lines));
    const children: SerNode[] = [];
    texts.forEach((t, idx) => {
      if (idx > 0) children.push(lineBreak());
      children.push(...parseInline(t, {}, ctx, true, cu));
    });
    (pendingItem.level.node.children as SerNode[]).push(
      listItemNode(
        pendingItem.strike ? applyStrike(children) : children,
        pendingItem.value,
      ),
    );
    pendingItem = null;
  };

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
    // Code fences swallow everything verbatim (modulo the deliberate
    // export-artifact unescape, fix 6).
    const fence = rawLine.match(/^```(.*)$/);
    if (fence) {
      if (inCode) {
        blocks.push(codeNode(codeLines.join("\n"), codeLang || "plain"));
        inCode = false;
        codeLines = [];
      } else {
        finalizePendingItem();
        activeFootnote = null;
        flushAll();
        inCode = true;
        codeLang = fence[1].trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(cu ? unescapePunct(rawLine) : rawLine);
      continue;
    }

    // Indented (list-nested) fences -> real code blocks (fix 10). Content is
    // dedented by the fence's own indentation, keeping deeper indentation
    // relative; the block lands at the top level (the editor cannot host a
    // code block inside a list item), splitting the surrounding list.
    if (opts.promotePseudo) {
      const ifence = rawLine.match(/^(\s+)```(.*)$/);
      if (ifence) {
        if (indentCode) {
          blocks.push(
            codeNode(indentCode.lines.join("\n"), indentCode.lang || "plain"),
          );
          indentCode = null;
        } else {
          finalizePendingItem();
          activeFootnote = null;
          flushAll();
          indentCode = { indent: ifence[1], lang: ifence[2].trim(), lines: [] };
        }
        continue;
      }
      if (indentCode) {
        let content = rawLine;
        if (content.startsWith(indentCode.indent)) {
          content = content.slice(indentCode.indent.length);
        } else {
          const dedentBy = indentCode.indent.length;
          content = content.replace(/^\s+/, (ws) =>
            ws.slice(Math.min(ws.length, dedentBy)),
          );
        }
        indentCode.lines.push(cu ? unescapePunct(content) : content);
        continue;
      }
    }

    const line = rawLine.replace(/\s+$/, "");

    // Indented pseudo-fence marker (legacy / harness baseline only): the
    // marker line and everything until the matching marker keep literal-prose
    // handling (html transforms off).
    let lineHtml = htmlMode && !pseudoFence;
    if (!opts.promotePseudo && /^\s+```/.test(rawLine)) {
      pseudoFence = !pseudoFence;
      lineHtml = false;
    }

    // Hard-break continuations of a pending list item (fixes 4 + 7).
    if (pendingItem) {
      const t = line.trim();
      const isCont =
        lineHtml &&
        t !== "" &&
        t !== "\\" &&
        !TASK_LINE_RE.test(line) &&
        !LIST_LINE_RE.test(line) &&
        !/^#{1,6}(\s|$)/.test(line) &&
        !/^(-{3,}|\*{3,}|_{3,})$/.test(t) &&
        !/^>/.test(line) &&
        !/^\s*\|/.test(line) &&
        !/^\[\^[^\]\s]+\]:/.test(line);
      if (isCont) {
        const { text, hard } = stripHardBreak(line.replace(HTML_COMMENT_RE, ""));
        pendingItem.lines.push(text);
        if (!hard) finalizePendingItem();
        continue;
      }
      finalizePendingItem();
    }

    // Footnote definitions "[^n]: …" with indented continuations (fix 1).
    if (lineHtml) {
      const def = line.match(/^\[\^([^\]\s]+)\]:\s?(.*)$/);
      if (def) {
        flushAll();
        activeFootnote = {
          label: def[1],
          lines: [def[2].replace(HTML_COMMENT_RE, "").trim()],
        };
        footnotes.push(activeFootnote);
        continue;
      }
      if (activeFootnote && /^\s+\S/.test(rawLine)) {
        activeFootnote.lines.push(line.replace(HTML_COMMENT_RE, "").trim());
        continue;
      }
    }
    activeFootnote = null;

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
      let text = rest.replace(HTML_COMMENT_RE, "").trim();
      let hard = false;
      if (lineHtml) ({ text, hard } = stripHardBreak(text));
      if (box === " ") {
        // Open task -> real task row + in-content task node (block-level, so
        // it splits any surrounding list, matching how the app hosts tasks).
        flushAll();
        const title =
          inlineToPlain(parseInline(text, {}, ctx, lineHtml, cu)).trim() ||
          text;
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
        if (hard) {
          pendingItem = {
            level,
            value: level.count,
            strike: true,
            lines: [text],
          };
        } else {
          (level.node.children as SerNode[]).push(
            listItemNode(
              applyStrike(parseInline(text, {}, ctx, lineHtml, cu)),
              level.count,
            ),
          );
        }
      }
      continue;
    }

    // Whitespace-only heading line ("#" + trailing spaces): an empty heading
    // in Amplenote — skip it entirely, but keep the block boundary (fix 5).
    if (lineHtml && /^#{1,6}$/.test(line)) {
      flushAll();
      continue;
    }

    // Headings (clamped to h3, the deepest the editor renders).
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const depth = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      let text = headingMatch[2].replace(HTML_COMMENT_RE, "").trim();
      if (lineHtml) text = stripHardBreak(text).text;
      blocks.push(headingNode(parseInline(text, {}, ctx, lineHtml, cu), `h${depth}`));
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      flushAll();
      blocks.push(hrNode());
      continue;
    }

    // Standalone HTML <hr> in prose -> the same horizontalrule node.
    if (lineHtml && /^<hr\s*\/?>$/i.test(line.trim())) {
      flushAll();
      blocks.push(hrNode());
      continue;
    }

    // Blockquote.
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushPara();
      flushList();
      let text = quoteMatch[1].replace(HTML_COMMENT_RE, "");
      let hard = false;
      if (lineHtml) ({ text, hard } = stripHardBreak(text));
      quoteLines.push({ text, html: lineHtml, hard });
      continue;
    }

    // Tables: no table nodes in the editor — preserve row content as text.
    // Fixed converter (fix 2): delimiter-only and all-empty rows are dropped;
    // real rows keep their cell text joined with " | ".
    if (/^\s*\|/.test(line)) {
      flushAll();
      const stripped = line.replace(HTML_COMMENT_RE, "");
      if (lineHtml) {
        const cells = splitTableRow(stripped);
        const isDelimiter =
          cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
        const isEmpty = cells.every((c) => c === "");
        if (isDelimiter || isEmpty) continue;
        const children: SerNode[] = [];
        cells.forEach((c, k) => {
          if (k > 0) children.push(textNode(" | "));
          children.push(...parseInline(c, {}, ctx, lineHtml, cu));
        });
        blocks.push(paragraphNode(children));
      } else {
        blocks.push(
          paragraphNode(parseInline(stripped, {}, ctx, lineHtml, cu)),
        );
      }
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
      let text = rest.replace(HTML_COMMENT_RE, "");
      if (lineHtml) {
        const s = stripHardBreak(text);
        if (s.hard) {
          pendingItem = {
            level,
            value: level.count,
            strike: false,
            lines: [s.text],
          };
          continue;
        }
        text = s.text;
      }
      (level.node.children as SerNode[]).push(
        listItemNode(parseInline(text, {}, ctx, lineHtml, cu), level.count),
      );
      continue;
    }

    // Plain prose line.
    flushQuote();
    flushList();
    let text = line.replace(HTML_COMMENT_RE, "");
    let hard = false;
    if (lineHtml) ({ text, hard } = stripHardBreak(text));
    paraLines.push({ text, html: lineHtml, hard });
  }

  if (inCode) {
    // Unterminated fence: keep what we have.
    blocks.push(codeNode(codeLines.join("\n"), codeLang || "plain"));
  }
  if (indentCode) {
    blocks.push(
      codeNode(indentCode.lines.join("\n"), indentCode.lang || "plain"),
    );
  }
  finalizePendingItem();
  flushAll();

  // Footnote definitions re-emitted as a trailing section (fix 1).
  if (footnotes.length > 0) {
    blocks.push(headingNode([textNode("Footnotes")], "h2"));
    for (const fn of footnotes) {
      const fnLines = fn.lines.filter(
        (l, k) => !(k === 0 && l === "" && fn.lines.length > 1),
      );
      const children: SerNode[] = [textNode(`[${fn.label}] `)];
      fnLines.forEach((l, k) => {
        if (k > 0) children.push(lineBreak());
        children.push(...parseInline(l, {}, ctx, true, cu));
      });
      blocks.push(paragraphNode(children));
    }
  }
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
  // MIRRORS: regenerate text_content for EVERY owner note from its CURRENT
  // content (fixed lexicalToPlainText). Never touches content or updated_at,
  // so it is safe for user-edited notes too. Independent of the export dir.
  // -------------------------------------------------------------------------
  if (MIRRORS) {
    console.log("=== REFRESH MIRRORS (text_content only, all owner notes) ===");
    const rows = await db
      .select({
        id: schema.notes.id,
        title: schema.notes.title,
        content: schema.notes.content,
        textContent: schema.notes.textContent,
      })
      .from(schema.notes)
      .where(eq(schema.notes.ownerId, OWNER));
    let updated = 0;
    let unchanged = 0;
    for (const r of rows) {
      const mirror = lexicalToPlainText(
        r.content as SerializedEditorState | null,
        TEXT_MIRROR_MAX,
      );
      if (mirror === (r.textContent ?? "")) {
        unchanged++;
        continue;
      }
      await db
        .update(schema.notes)
        .set({ textContent: mirror })
        .where(
          and(eq(schema.notes.id, r.id), eq(schema.notes.ownerId, OWNER)),
        );
      updated++;
      console.log(`  mirror updated: ${r.title}`);
    }
    console.log(
      `\n  mirrors updated: ${updated}, unchanged: ${unchanged}, total owner notes: ${rows.length}`,
    );
    console.log("\n✅ Mirror refresh complete.");
    return;
  }

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
  const literalHtml = new Map<string, number>(); // tag -> count left literal
  const literalHtmlNotes = new Set<string>();

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
    onLiteralHtml: (tag) => {
      literalHtml.set(tag, (literalHtml.get(tag) ?? 0) + 1);
      literalHtmlNotes.add(noteTitle);
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
      true,
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
  /** REFRESH mode: every daily plan whose date already has a DB row. */
  const dailyRefresh: {
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
      const out = convertMarkdown(
        f.body,
        f.uuid,
        makeCtx(ref.title, linkTargets),
        true,
      );
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
    if (existingNote) dailyRefresh.push({ plan, existingNote });
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

  console.log("\n=== Inline HTML left literal (unknown/unclosed tags, prose context) ===");
  if (literalHtml.size === 0) {
    console.log("  none");
  } else {
    for (const [tag, n] of [...literalHtml.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  <${tag}>: ${n}`);
    }
    console.log(`  in notes: ${[...literalHtmlNotes].join(", ")}`);
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

  // -------------------------------------------------------------------------
  // Converter verification harness (runs before any refresh write).
  // (a) zero literal "<mark" left in prose text nodes (checked on the real
  //     plans AND on standalone conversions of every export file);
  // (b) code context — fenced-block contents and inline backtick spans, in
  //     document order — is byte-identical between the legacy converter
  //     (htmlMode=false, the exact pre-fix behavior) and the fixed converter.
  // -------------------------------------------------------------------------
  if (REFRESH || VERIFY) {
    console.log("\n=== HTML converter verification ===");
    const mkNoopCtx = (): InlineCtx => ({
      fileToNote,
      uuidToNote,
      onNoteLink: () => {},
      onUnresolvedNoteLink: () => {},
      onImage: (rel) => ({ src: `/api/uploads/${uuidv5(`image:${rel}`)}` }),
      onAttachment: () => {},
    });
    // Prose text that would indicate a fidelity fix failed to fire. (No
    // checks here for `***` or bare `#`: the export legitimately contains
    // ESCAPED literal asterisk runs (`\*\*\*\*` redactions, syntax docs) and
    // quoted heading markup (`> # …`) — those fixes are covered by the
    // synthetic assertions below instead.)
    const proseArtifact = (t: string): string | null => {
      if (t.includes("<mark")) return "<mark";
      if (/\[\^[^\]\s]+\]/.test(t)) return "footnote marker";
      if (t.includes("![](")) return "raw image markdown";
      if (t.includes("local://")) return "local://";
      if (t.includes("]()")) return "empty link";
      if (/^[\s|:-]+$/.test(t) && t.includes("|") && t.includes("-"))
        return "table delimiter row";
      return null;
    };

    let baseMismatches = 0; // legacy vs fixed(no promo, no unescape): must be 0
    let promoMismatches = 0; // pseudo-fence promotion bookkeeping errors
    let unescapeMismatches = 0; // code-unescape rule applied wrong
    let unescapeChanged = 0; // code segments DELIBERATELY changed by fix 6
    let promotedBlocks = 0;
    let codeSegments = 0;
    let artifactLeaks = 0;
    for (const f of parsed) {
      const legacy = convertMarkdown(f.body, f.uuid, mkNoopCtx(), false);
      const base = convertMarkdown(f.body, f.uuid, mkNoopCtx(), true, {
        promotePseudo: false,
        codeUnescape: false,
      });
      const promo = convertMarkdown(f.body, f.uuid, mkNoopCtx(), true, {
        codeUnescape: false,
      });
      const full = convertMarkdown(f.body, f.uuid, mkNoopCtx(), true);
      const legacyCode = collectContexts(legacy.blocks).code;
      const baseCode = collectContexts(base.blocks).code;
      const promoCode = collectContexts(promo.blocks).code;
      const fullCtx = collectContexts(full.blocks);
      codeSegments += fullCtx.code.length;

      // (1) Every prose-context fix leaves code context byte-identical.
      if (JSON.stringify(legacyCode) !== JSON.stringify(baseCode)) {
        baseMismatches++;
        console.log(`  CODE MISMATCH (prose fixes touched code): ${f.file}`);
        const max = Math.max(legacyCode.length, baseCode.length);
        for (let k = 0; k < max; k++) {
          if (legacyCode[k] !== baseCode[k]) {
            console.log(`    old[${k}]: ${JSON.stringify(legacyCode[k]).slice(0, 160)}`);
            console.log(`    new[${k}]: ${JSON.stringify(baseCode[k]).slice(0, 160)}`);
            break;
          }
        }
      }

      // (2) Pseudo-fence promotion (fix 10): the promoted converter's code
      // list must be the baseline list with the promoted blocks inserted in
      // document order; every promoted line must be a real source line
      // (modulo the dedent), and inline spans swallowed by a promoted region
      // are accounted for.
      {
        const srcLines = new Set(
          f.body.split(/\r?\n/).map((l) => l.replace(/^\s+/, "")),
        );
        let bi = 0;
        let ok = true;
        for (const seg of promoCode) {
          if (bi < baseCode.length && seg === baseCode[bi]) {
            bi++;
            continue;
          }
          if (seg.startsWith("block:")) {
            const content = seg.slice("block:".length);
            const linesOk = content
              .split("\n")
              .every((l) => l.trim() === "" || srcLines.has(l.replace(/^\s+/, "")));
            while (
              bi < baseCode.length &&
              baseCode[bi].startsWith("inline:") &&
              content.includes(baseCode[bi].slice("inline:".length))
            ) {
              bi++;
            }
            if (linesOk) {
              promotedBlocks++;
              continue;
            }
          }
          ok = false;
          console.log(
            `  PROMOTION MISMATCH: ${f.file}: ${JSON.stringify(seg).slice(0, 160)}`,
          );
          break;
        }
        if (ok && bi !== baseCode.length) {
          ok = false;
          console.log(
            `  PROMOTION MISMATCH: ${f.file}: baseline code segment lost: ${JSON.stringify(baseCode[bi]).slice(0, 160)}`,
          );
        }
        if (!ok) promoMismatches++;
      }

      // (3) Code unescape (fix 6, the DELIBERATE code-context change): the
      // full converter's code list must equal the promoted list with the
      // intended transform applied; count how many segments actually changed.
      if (fullCtx.code.length !== promoCode.length) {
        unescapeMismatches++;
        console.log(`  UNESCAPE MISMATCH (segment count): ${f.file}`);
      } else {
        for (let k = 0; k < promoCode.length; k++) {
          const expected = unescapePunct(promoCode[k]);
          if (fullCtx.code[k] !== expected) {
            unescapeMismatches++;
            console.log(`  UNESCAPE MISMATCH: ${f.file}`);
            console.log(`    expected[${k}]: ${JSON.stringify(expected).slice(0, 160)}`);
            console.log(`    got[${k}]:      ${JSON.stringify(fullCtx.code[k]).slice(0, 160)}`);
            break;
          }
          if (expected !== promoCode[k]) unescapeChanged++;
        }
      }

      // (4) No fidelity-fix artifacts left in prose.
      for (const t of fullCtx.prose) {
        const what = proseArtifact(t);
        if (what) {
          artifactLeaks++;
          console.log(
            `  PROSE ARTIFACT (${what}): ${f.file}: ${JSON.stringify(t).slice(0, 120)}`,
          );
        }
      }
    }
    let planLeaks = 0;
    for (const p of allPlansForTasks) {
      for (const t of collectContexts(p.blocks).prose) {
        const what = proseArtifact(t);
        if (what) {
          planLeaks++;
          console.log(
            `  PLAN PROSE ARTIFACT (${what}): ${p.title}: ${JSON.stringify(t).slice(0, 120)}`,
          );
        }
      }
    }

    // Synthetic per-fix assertions: tiny documents through the FULL fixed
    // converter, checked against the exact intended output shape.
    let synFailures = 0;
    const synCheck = (
      name: string,
      md: string,
      test: (out: ConvertOutput) => boolean,
    ) => {
      const out = convertMarkdown(md, "synthetic", mkNoopCtx(), true);
      if (!test(out)) {
        synFailures++;
        console.log(
          `  SYNTHETIC CHECK FAILED: ${name}: ${JSON.stringify(out.blocks).slice(0, 240)}`,
        );
      }
    };
    const flatText = (blocks: SerNode[]): string =>
      collectContexts(blocks).prose.join("");
    const findNodes = (blocks: SerNode[], pred: (n: SerNode) => boolean): SerNode[] => {
      const hits: SerNode[] = [];
      const walk = (n: SerNode) => {
        if (pred(n)) hits.push(n);
        if (Array.isArray(n.children)) for (const c of n.children as SerNode[]) walk(c);
      };
      for (const b of blocks) walk(b);
      return hits;
    };
    synCheck("fix 1: footnotes", "x[^1] y\n\n[^1]: DEF\n    CONT\n", (o) => {
      const t = flatText(o.blocks);
      return (
        t.includes("x[1] y") &&
        t.includes("Footnotes") &&
        t.includes("[1] DEF") &&
        t.includes("CONT") &&
        !t.includes("[^")
      );
    });
    synCheck("fix 2: tables", "| a | b |\n|-|-|\n| | |\n|c|**d**|\n", (o) => {
      const t = flatText(o.blocks);
      return t.includes("a | b") && t.includes("c | ") && t.includes("d") && !t.includes("-|");
    });
    synCheck("fix 3: ***bold italic***", "***both*** rest\n", (o) => {
      const hits = findNodes(o.blocks, (n) => n.text === "both");
      return (
        hits.length === 1 &&
        ((hits[0].format as number) & 3) === 3 &&
        !flatText(o.blocks).includes("*")
      );
    });
    synCheck("fix 4: trailing \\ hard break", "foo\\\nbar\n", (o) => {
      const breaks = findNodes(o.blocks, (n) => n.type === "linebreak");
      return breaks.length === 1 && !flatText(o.blocks).includes("\\") && flatText(o.blocks).includes("foo");
    });
    synCheck("fix 5: whitespace-only heading", "before\n\n#   \n\nafter\n", (o) => {
      const t = flatText(o.blocks);
      return t.includes("before") && t.includes("after") && !t.includes("#");
    });
    synCheck("fix 7: cross-line ~~ in a list item", "- ~~a b\\\nc d~~\n", (o) => {
      const struck = findNodes(
        o.blocks,
        (n) => typeof n.text === "string" && ((n.format as number) & 4) !== 0,
      );
      return (
        !flatText(o.blocks).includes("~~") &&
        struck.some((n) => (n.text as string).includes("a b")) &&
        struck.some((n) => (n.text as string).includes("c d"))
      );
    });
    synCheck("fix 8: schemeless + empty links", "[x](foo.com) [y]()\n", (o) => {
      const links = findNodes(o.blocks, (n) => n.type === "link");
      return (
        links.length === 1 &&
        links[0].url === "https://foo.com" &&
        flatText(o.blocks).includes("y") &&
        !flatText(o.blocks).includes("]()")
      );
    });
    synCheck("fix 9: local:// images", "![](local://abc?failed)\n\n![alt text](local://def)\n", (o) => {
      const t = flatText(o.blocks);
      return t.includes("(missing image)") && t.includes("alt text") && !t.includes("local://");
    });
    synCheck("fix 10: indented fence promotion", "1. a\n\n    ```js\n    code \\[x\\]\n      deep\n    ```\n\n1. b\n", (o) => {
      const code = collectContexts(o.blocks).code;
      return (
        code.length === 1 &&
        code[0] === "block:code [x]\n  deep" &&
        flatText(o.blocks).includes("a") &&
        flatText(o.blocks).includes("b")
      );
    });
    synCheck("fix 6: inline code unescape", "prose `a \\[b\\]` end\n", (o) => {
      const code = collectContexts(o.blocks).code;
      return code.length === 1 && code[0] === "inline:a [b]";
    });
    console.log(`  files checked: ${parsed.length}; code segments compared: ${codeSegments}`);
    console.log(`  code-context mismatches (legacy vs fixed, promotion+unescape excluded): ${baseMismatches}`);
    console.log(`  pseudo-fence blocks promoted to code: ${promotedBlocks} (bookkeeping mismatches: ${promoMismatches})`);
    console.log(`  code segments deliberately unescaped (fix 6): ${unescapeChanged} (rule mismatches: ${unescapeMismatches})`);
    console.log(`  prose artifacts (mark/footnote/table/image/link leaks): ${artifactLeaks} (files), ${planLeaks} (planned notes)`);
    console.log(`  synthetic per-fix assertions failed: ${synFailures} of 10`);
    if (
      baseMismatches > 0 ||
      promoMismatches > 0 ||
      unescapeMismatches > 0 ||
      artifactLeaks > 0 ||
      planLeaks > 0 ||
      synFailures > 0
    ) {
      throw new Error("HTML converter verification FAILED — aborting before any write.");
    }
    console.log("  verification PASSED.");
    if (!REFRESH) {
      console.log("\n--verify-html only — nothing was written.");
      return;
    }
  }

  // -------------------------------------------------------------------------
  // REFRESH: regenerate content for import-owned notes the user hasn't edited.
  // -------------------------------------------------------------------------
  if (REFRESH) {
    console.log("\n=== REFRESH UNEDITED ===");
    const rows =
      plannedNoteIds.length > 0
        ? await db
            .select()
            .from(schema.notes)
            .where(
              and(
                eq(schema.notes.ownerId, OWNER),
                inArray(schema.notes.id, plannedNoteIds),
              ),
            )
        : [];
    const rowById = new Map(rows.map((r) => [r.id, r]));

    let refreshed = 0;
    let unchanged = 0;
    let restamped = 0;
    let notInDb = 0;
    const skippedEdited: { title: string; db: Date; imported: Date }[] = [];

    /**
     * Window-gated rows whose content is already clean still carry the
     * machine stamp — write updated_at back to the frontmatter value so
     * future runs use the strict gate (and the app stops showing them as
     * recently updated). No content/text_content write.
     */
    const restampIfNeeded = async (
      id: string,
      title: string,
      dbUpdated: number,
      importedUpdated: Date,
    ) => {
      if (dbUpdated === importedUpdated.getTime()) {
        unchanged++;
        return;
      }
      await db
        .update(schema.notes)
        .set({ updatedAt: importedUpdated })
        .where(and(eq(schema.notes.id, id), eq(schema.notes.ownerId, OWNER)));
      restamped++;
      console.log(`  restamped (content already clean): ${title}`);
    };

    for (const p of plans) {
      const row = rowById.get(p.id);
      if (!row) {
        notInDb++;
        continue;
      }
      const dbUpdated = (row.updatedAt as Date).getTime();
      // Unedited when updated_at still equals the imported frontmatter value,
      // OR (dailies only) when it sits in the machine-stamp window left by
      // this script's own earlier repair run. Refreshing writes the
      // frontmatter value back, restoring the strict gate for future runs.
      const unedited =
        dbUpdated === p.updatedAt.getTime() ||
        (p.dailyDate !== null && inStampWindow(dbUpdated));
      if (!unedited) {
        skippedEdited.push({
          title: row.title,
          db: row.updatedAt as Date,
          imported: p.updatedAt,
        });
        continue;
      }
      const content = rootDoc(p.blocks);
      // jsonb does not preserve key order — compare order-independently.
      if (stableStringify(content) === stableStringify(row.content)) {
        await restampIfNeeded(p.id, row.title, dbUpdated, p.updatedAt);
        continue;
      }
      await db
        .update(schema.notes)
        .set({
          content,
          textContent: lexicalToPlainText(
            content as unknown as SerializedEditorState,
            TEXT_MIRROR_MAX,
          ),
          // Keep updated_at exactly the imported value: the refresh must stay
          // invisible to the has-the-user-edited-it check (and be idempotent).
          updatedAt: p.updatedAt,
        })
        .where(
          and(eq(schema.notes.id, p.id), eq(schema.notes.ownerId, OWNER)),
        );
      refreshed++;
      console.log(
        `  refreshed: ${p.title}${p.dailyDate ? ` (daily ${p.dailyDate})` : ""}`,
      );

      // Safety: content may reference task ids missing from the DB (only
      // possible if a title-derived id changed). Insert-only, idempotent.
      for (const t of p.tasks) {
        if (existingTaskIds.has(t.id)) continue;
        await db
          .insert(schema.tasks)
          .values({ id: t.id, ownerId: OWNER, title: t.title, createdAt: p.createdAt })
          .onConflictDoNothing();
        await db
          .insert(schema.noteTasks)
          .values({ noteId: p.id, taskId: t.id, sortOrder: t.sortOrder })
          .onConflictDoNothing();
        console.log(`    inserted missing task: ${t.title}`);
      }
    }

    // Dailies whose date already has a DB row (they are never in `plans`).
    // Two shapes:
    // - marker present (append-merged into a pre-existing app note): rebuild
    //   ONLY the post-marker imported blocks; everything up to and including
    //   the marker paragraph is kept byte-identical.
    // - no marker (import-created daily): same rules as regular notes
    //   (updated_at gate + regenerate).
    let mergedRebuilt = 0;
    let mergedUntouched = 0;
    for (const { plan, existingNote } of dailyRefresh) {
      const contentObj = (existingNote.content ?? rootDoc([])) as {
        root: { children: SerNode[] };
      };
      const children = contentObj.root.children ?? [];
      const markerIdx = children.findIndex((c) =>
        JSON.stringify(c).includes(MERGE_MARKER),
      );

      if (markerIdx < 0) {
        const dbUpdated = (existingNote.updatedAt as Date).getTime();
        // Same gate as above: strict frontmatter equality, extended by the
        // machine-stamp window from this script's earlier repair run.
        const unedited =
          dbUpdated === plan.updatedAt.getTime() || inStampWindow(dbUpdated);
        if (!unedited) {
          skippedEdited.push({
            title: existingNote.title,
            db: existingNote.updatedAt as Date,
            imported: plan.updatedAt,
          });
          continue;
        }
        const content = rootDoc(plan.blocks);
        if (stableStringify(content) === stableStringify(existingNote.content)) {
          await restampIfNeeded(
            existingNote.id,
            existingNote.title,
            dbUpdated,
            plan.updatedAt,
          );
          continue;
        }
        await db
          .update(schema.notes)
          .set({
            content,
            textContent: lexicalToPlainText(
              content as unknown as SerializedEditorState,
              TEXT_MIRROR_MAX,
            ),
            updatedAt: plan.updatedAt,
          })
          .where(
            and(
              eq(schema.notes.id, existingNote.id),
              eq(schema.notes.ownerId, OWNER),
            ),
          );
        refreshed++;
        console.log(`  refreshed: ${existingNote.title} (daily ${plan.dailyDate})`);
        continue;
      }

      const head = children.slice(0, markerIdx + 1);
      const oldTail = children.slice(markerIdx + 1);
      const newTail = plan.blocks;
      if (stableStringify(oldTail) === stableStringify(newTail)) {
        mergedUntouched++;
        continue;
      }
      const merged = {
        ...contentObj,
        root: { ...contentObj.root, children: [...head, ...newTail] },
      };
      await db
        .update(schema.notes)
        .set({
          content: merged,
          textContent: lexicalToPlainText(
            merged as unknown as SerializedEditorState,
            TEXT_MIRROR_MAX,
          ),
          updatedAt: existingNote.updatedAt as Date, // preserved
        })
        .where(
          and(
            eq(schema.notes.id, existingNote.id),
            eq(schema.notes.ownerId, OWNER),
          ),
        );
      mergedRebuilt++;
      console.log(
        `  rebuilt merged daily ${plan.dailyDate} (${existingNote.id}): ${head.length} pre/incl-marker blocks preserved, tail regenerated (${oldTail.length} -> ${newTail.length} blocks)`,
      );
    }

    console.log(`\n  refreshed: ${refreshed}`);
    console.log(`  unchanged (already clean): ${unchanged}`);
    console.log(`  restamped only (clean content, machine stamp -> frontmatter): ${restamped}`);
    console.log(`  merged dailies rebuilt: ${mergedRebuilt}, left untouched: ${mergedUntouched}`);
    console.log(`  skipped (edited since import — NOT touched): ${skippedEdited.length}`);
    for (const s of skippedEdited) {
      console.log(
        `    - "${s.title}" (db updated ${s.db.toISOString()} != imported ${s.imported.toISOString()})`,
      );
    }
    if (notInDb > 0) console.log(`  not present in DB (never imported): ${notInDb}`);
    console.log("\n✅ Refresh complete.");
    return;
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
