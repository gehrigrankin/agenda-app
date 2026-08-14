"use client";

import { useRef, useState } from "react";
import { Check, Plus, Tag as TagIcon } from "lucide-react";

import {
  createTagAction,
  setTaskTagsAction,
  type TagResult,
  type TagWithCountResult,
} from "@/app/app/actions";
import { isValidTagName, normalizeTagName } from "@/lib/hashtags";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";

/**
 * Per-row tag editor for the Tasks page — the deliberate counterpart to
 * typing "#health" in the quick-add, for the tasks that were captured before
 * you knew what they were.
 *
 * Saves on every toggle rather than behind an OK button: a popover with a
 * commit step invites you to close it the wrong way. Each toggle writes the
 * task's whole tag set (`setTaskTagsAction`), so a failed save can restore
 * exactly what was there before.
 */

/**
 * Read-only tag chip — the same shape wherever a task shows its labels.
 * `maxWidth` exists because the chip never shrinks: on a narrow surface
 * (the home widget's 260px panel) an unbounded chip eats the task title
 * outright, so that caller caps it and the name ellipsizes instead.
 */
export function TagChip({
  tag,
  maxWidth = "max-w-[8rem]",
}: {
  tag: TagResult;
  maxWidth?: string;
}) {
  return (
    <span
      className={`flex ${maxWidth} flex-none items-center rounded-full border border-white/8 bg-white/4 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-400`}
      style={tag.color ? { color: tag.color } : undefined}
    >
      {/* The "#" is nested, not a flex sibling — a gap between it and the name
          makes the same label read differently here than in the picker. */}
      <span className="truncate">
        <span className="opacity-60">#</span>
        {tag.name}
      </span>
    </span>
  );
}

export function TaskTagPicker({
  taskId,
  tags,
  allTags,
  onTagsChange,
  onTagCreated,
}: {
  taskId: string;
  tags: TagResult[];
  allTags: TagWithCountResult[];
  /** Optimistic write-through; called again with the old value on failure. */
  onTagsChange: (taskId: string, next: TagResult[]) => void;
  /** A tag that didn't exist a moment ago — the page adds it to its list. */
  onTagCreated: (tag: TagResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Wraps the trigger too, so the press that toggles the picker shut isn't
  // also read as an outside click.
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useOutsideClose(open, wrapRef, () => setOpen(false));

  const selected = new Set(tags.map((t) => t.id));
  const normalized = normalizeTagName(query);
  const matches = allTags.filter((t) =>
    normalized ? normalizeTagName(t.name).includes(normalized) : true,
  );
  // Only offer to create when nothing already carries that exact name —
  // otherwise the create row sits under an identical toggle row.
  const canCreate =
    isValidTagName(normalized) &&
    !allTags.some((t) => normalizeTagName(t.name) === normalized);

  const save = (next: TagResult[]) => {
    const previous = tags;
    onTagsChange(taskId, next);
    setTaskTagsAction(
      taskId,
      next.map((t) => t.id),
    ).catch((err) => {
      console.error("[tags] save failed:", err);
      onTagsChange(taskId, previous);
    });
  };

  const toggle = (tag: TagResult) => {
    save(
      selected.has(tag.id)
        ? tags.filter((t) => t.id !== tag.id)
        : [...tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const tag = await createTagAction(normalized);
      if (tag) {
        onTagCreated(tag);
        save([...tags, tag].sort((a, b) => a.name.localeCompare(b.name)));
        setQuery("");
      }
    } catch (err) {
      console.error("[tags] create failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={wrapRef} className="relative flex-none">
      <button
        type="button"
        aria-label="Edit tags"
        aria-expanded={open}
        title="Edit tags"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={`flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md hover:bg-white/8 ${
          open ? "bg-white/8 text-ink-200" : "text-ink-600 hover:text-ink-300"
        }`}
      >
        <TagIcon className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Enter takes the obvious action: toggle the one match, or
              // create what you typed when there is none.
              if (matches.length === 1) toggle(matches[0]);
              else if (canCreate) void create();
            }}
            placeholder="Find or create a tag…"
            className="mb-1 w-full rounded-lg border border-white/8 bg-input px-2.5 py-1.5 text-[0.71875rem] text-ink-100 outline-none placeholder:text-ink-600"
          />

          <div className="max-h-52 overflow-y-auto">
            {matches.length === 0 && !canCreate && (
              <p className="px-2 py-2 text-[0.6875rem] text-ink-600">
                {allTags.length === 0
                  ? "No tags yet — type one to create it."
                  : "No match."}
              </p>
            )}
            {matches.map((tag) => {
              const on = selected.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.71875rem] hover:bg-white/6 ${
                    on ? "text-sage" : "text-ink-300"
                  }`}
                >
                  <Check
                    className={`h-3 w-3 flex-none ${on ? "" : "opacity-0"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="opacity-60">#</span>
                    {tag.name}
                  </span>
                  <span className="flex-none text-[0.625rem] tabular-nums text-ink-600">
                    {tag.taskCount}
                  </span>
                </button>
              );
            })}
          </div>

          {canCreate && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="mt-1 flex w-full items-center gap-1.5 rounded-lg border-t border-white/6 px-2 py-1.5 text-left text-[0.71875rem] text-ink-400 hover:bg-white/6 hover:text-ink-200 disabled:opacity-50"
            >
              <Plus className="h-3 w-3 flex-none" />
              <span className="min-w-0 truncate">
                Create #{normalized}
              </span>
            </button>
          )}
        </div>
      )}
    </span>
  );
}
