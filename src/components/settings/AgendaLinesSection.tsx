"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";

import {
  createAgendaLineAction,
  listTagsAction,
  setAgendaLinesAction,
  type AgendaLineResult,
  type TagWithCountResult,
} from "@/app/app/actions";

/**
 * Settings surface for "agenda lines" — the pinned tags that print as ruled
 * lines on every day of the Today page (see AgendaLinesSection's sibling,
 * the agenda's LINES band). Reorder/remove/pin all funnel through the same
 * `setAgendaLinesAction(orderedIds)` call, which replaces the pinned set +
 * order wholesale, so every mutation here is "compute the next full order,
 * send it, adopt the server's answer". Task counts don't come back from that
 * call (it only knows tags, not tasks), so we keep a running id → count map
 * from the last full `listTagsAction()` load and merge it back in — counts
 * are stable across reorders/pins/unpins and default to 0 for a line that
 * was just created.
 */

const MAX_CHIPS = 12;

function sortLines(a: TagWithCountResult, b: TagWithCountResult): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function sortOthers(a: TagWithCountResult, b: TagWithCountResult): number {
  return a.name.localeCompare(b.name);
}

export function AgendaLinesSection() {
  const [lines, setLines] = useState<TagWithCountResult[]>([]);
  const [others, setOthers] = useState<TagWithCountResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  // Last known open-task count per tag id — setAgendaLinesAction/
  // createAgendaLineAction return bare lines with no count, so this fills
  // the gap without a refetch on every click.
  const countsRef = useRef<Map<string, number>>(new Map());

  const refetch = async () => {
    try {
      const all = await listTagsAction();
      countsRef.current = new Map(all.map((t) => [t.id, t.taskCount]));
      setLines(all.filter((t) => t.pinned).sort(sortLines));
      setOthers(all.filter((t) => !t.pinned).sort(sortOthers));
    } catch (err) {
      console.error("[agenda-lines] load failed:", err);
    }
  };

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const toLineTag = (line: AgendaLineResult): TagWithCountResult => ({
    id: line.id,
    name: line.name,
    color: line.color,
    pinned: true,
    sortOrder: line.sortOrder,
    taskCount: countsRef.current.get(line.id) ?? 0,
  });

  /** Send the full new pinned order, then adopt the server's answer. */
  const applyOrder = async (nextLines: TagWithCountResult[]) => {
    setLines(nextLines);
    setSaving(true);
    try {
      const result = await setAgendaLinesAction(nextLines.map((l) => l.id));
      setLines(result.map(toLineTag));
    } catch (err) {
      console.error("[agenda-lines] reorder failed:", err);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const moveLine = (id: string, dir: -1 | 1) => {
    if (saving) return;
    const idx = lines.findIndex((l) => l.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= lines.length) return;
    const next = [...lines];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    void applyOrder(next);
  };

  const removeLine = (id: string) => {
    if (saving) return;
    const removed = lines.find((l) => l.id === id);
    if (!removed) return;
    setOthers((prev) =>
      [...prev, { ...removed, pinned: false }].sort(sortOthers),
    );
    void applyOrder(lines.filter((l) => l.id !== id));
  };

  const pinTag = (tag: TagWithCountResult) => {
    if (saving) return;
    setOthers((prev) => prev.filter((o) => o.id !== tag.id));
    void applyOrder([
      ...lines,
      { ...tag, pinned: true, sortOrder: lines.length },
    ]);
  };

  const createLine = async (rawName: string) => {
    const name = rawName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const created = await createAgendaLineAction(name);
      if (!created) return;
      if (!countsRef.current.has(created.id)) countsRef.current.set(created.id, 0);
      setLines((prev) =>
        prev.some((l) => l.id === created.id) ? prev : [...prev, toLineTag(created)],
      );
      setOthers((prev) => prev.filter((o) => o.id !== created.id));
      setDraft("");
    } catch (err) {
      console.error("[agenda-lines] create failed:", err);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const visibleChips = others.slice(0, MAX_CHIPS);
  const extraChips = others.length - visibleChips.length;

  return (
    <div id="agenda-lines" className="mt-5 scroll-mt-4">
      <span className="px-1 text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
        Agenda lines
      </span>
      <p className="mt-1 px-1 text-xs text-ink-600">
        The subjects printed on every day of your agenda. Tasks tagged with a
        line land on it.
      </p>

      <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
        {loading ? (
          <div className="flex h-13 min-h-[3.25rem] items-center px-3.5 text-xs text-ink-600">
            Loading…
          </div>
        ) : lines.length === 0 ? (
          <div className="flex h-13 min-h-[3.25rem] items-center px-3.5 text-xs text-ink-600">
            No lines yet — add one below.
          </div>
        ) : (
          lines.map((line, i) => (
            <div
              key={line.id}
              className={`flex h-13 min-h-[3.25rem] items-center gap-2.5 px-3.5 ${
                i === 0 ? "" : "border-t border-white/6"
              }`}
            >
              <GripVertical
                aria-hidden="true"
                className="h-4 w-4 flex-none text-ink-700"
              />
              <span
                className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink-200"
                style={line.color ? { color: line.color } : undefined}
              >
                <span className="opacity-60">#</span>
                {line.name}
              </span>
              <span className="flex-none text-xs text-ink-600">
                {line.taskCount} open
              </span>
              <button
                type="button"
                aria-label="Move up"
                disabled={saving || i === 0}
                onClick={() => moveLine(line.id, -1)}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-200 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={saving || i === lines.length - 1}
                onClick={() => moveLine(line.id, 1)}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-200 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Remove line"
                disabled={saving}
                onClick={() => removeLine(line.id)}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-[#D9938A] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add a line */}
      <div className="mt-3 rounded-2xl border border-white/7 bg-white/2 p-3">
        <form
          className="flex items-center gap-2 rounded-lg border border-white/7 bg-input px-2.5 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createLine(draft);
          }}
        >
          <Plus className="h-3 w-3 flex-none text-ink-600" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New line, e.g. Work"
            disabled={saving}
            className="min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
          />
        </form>

        {others.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {visibleChips.map((tag) => (
              <button
                key={tag.id}
                type="button"
                disabled={saving}
                onClick={() => pinTag(tag)}
                style={tag.color ? { color: tag.color } : undefined}
                className="flex flex-none items-center rounded-full border border-white/8 bg-white/4 px-2 py-1 text-[0.6875rem] font-medium text-ink-400 hover:bg-white/8 hover:text-ink-200 disabled:opacity-50"
              >
                <span className="opacity-60">#</span>
                {tag.name}
              </button>
            ))}
            {extraChips > 0 && (
              <span className="text-xs text-ink-600">+{extraChips} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
