"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckSquare,
  ChevronDown,
  Clock,
  ExternalLink,
  Folder,
  Globe,
  NotebookPen,
  User,
  X,
} from "lucide-react";

import type { InboxItemResult } from "@/app/app/inbox/actions";
import { SidebarToggles } from "@/components/layout/PageLayout";
import { SIDEBAR_FOCUS } from "@/components/layout/sidebar";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import {
  domainOf,
  folderLabel,
  receivedLabel,
  snoozePresets,
} from "@/lib/inbox-triage";

import { SOURCE_META, SomewhereElsePicker } from "./inbox-shared";

/**
 * The selected item (Notes Sidebars design §5f): title, "from X · time", the
 * body, then the FILE IT card — a destination chip row (the suggested folder,
 * a folder you pick, a plain note, or "Make task"), the primary
 * "Accept · ↵" and a Snooze split button.
 */

export type FileChoice =
  | { kind: "suggested" }
  | { kind: "note" }
  | { kind: "task" }
  | { kind: "folder"; bubbleId: string | null; title: string };

export function defaultChoice(item: InboxItemResult): FileChoice {
  return folderLabel(item.bubbleTitle, item.suggestionLabel)
    ? { kind: "suggested" }
    : { kind: "note" };
}

/** "from Email · 8:12 AM" — there is no sender column, so the source stands in. */
function fromLine(item: InboxItemResult, now: Date): string {
  const when = receivedLabel(item.receivedAt, now);
  const domain = domainOf(item.url);
  if (item.source === "link") return `from ${domain ?? "the web"} · ${when}`;
  return `from ${SOURCE_META[item.source].long.toLowerCase()} · ${when}`;
}

function Chip({
  selected,
  onClick,
  icon: Icon,
  children,
  trailing,
  ...rest
}: {
  selected?: boolean;
  onClick: () => void;
  icon: typeof Folder;
  children: React.ReactNode;
  trailing?: React.ReactNode;
} & Pick<React.AriaAttributes, "aria-haspopup" | "aria-expanded">) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        // A mouse-picked chip must not keep focus: Enter then accepts the
        // item instead of re-pressing the chip (keyboard activation keeps it).
        if (e.detail > 0) e.currentTarget.blur();
      }}
      aria-pressed={selected}
      {...rest}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[0.875rem] transition-colors touch:h-11 ${SIDEBAR_FOCUS} ${
        selected
          ? "border-sage/45 bg-sage/14 text-sage"
          : "border-white/8 bg-white/4 text-ink-300 hover:bg-white/8 hover:text-ink-100"
      }`}
    >
      <Icon className="h-3.5 w-3.5 flex-none" />
      {children}
      {trailing}
    </button>
  );
}

export function InboxDetail({
  item,
  mode,
  now,
  choice,
  onChoice,
  person,
  onAccept,
  onSnooze,
  onUnsnooze,
  onDismiss,
  headerTrailing,
  emptyTitle,
  emptyText,
  emptyHint,
}: {
  item: InboxItemResult | null;
  mode: "triage" | "snoozed" | "filed";
  now: Date | null;
  choice: FileChoice;
  onChoice: (c: FileChoice) => void;
  person: { id: string; name: string } | null;
  onAccept: () => void;
  onSnooze: (until: Date) => void;
  onUnsnooze: () => void;
  onDismiss: () => void;
  headerTrailing?: React.ReactNode;
  emptyTitle: string;
  emptyText: string;
  /** Show the "install the app and share" hint (only for a truly empty queue). */
  emptyHint?: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const snoozeRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(picker, pickerRef, () => setPicker(false));
  useOutsideClose(snoozeMenu, snoozeRef, () => setSnoozeMenu(false));

  const header = (
    <header className="flex min-h-[3.25rem] flex-none items-center gap-3 border-b border-white/6 px-5 py-1.5 touch:min-h-[3.75rem]">
      <SidebarToggles />
      <div className="min-w-0 flex-1">
        {item && now ? (
          <>
            <h1 className="truncate text-[1.25rem] leading-tight font-semibold text-ink-100">
              {item.title}
            </h1>
            <p className="truncate text-[0.8125rem] leading-tight text-ink-500">
              {fromLine(item, now)}
              {item.isSample && " · sample"}
            </p>
          </>
        ) : (
          <h1 className="truncate text-[1.25rem] leading-tight font-semibold text-ink-100">
            {emptyTitle}
          </h1>
        )}
      </div>
      {headerTrailing}
    </header>
  );

  if (!item || !now) {
    return (
      <>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-[0.9375rem] font-medium text-ink-300">
            {emptyText}
          </p>
          {emptyHint && (
            <p className="max-w-sm text-[0.8125rem] text-ink-600">
              Install the app, then share links, photos, and text from any other
              app — they land straight here, ready to file as notes.
            </p>
          )}
        </div>
      </>
    );
  }

  const suggested = folderLabel(item.bubbleTitle, item.suggestionLabel);
  const domain = domainOf(item.url);
  const hasBody = Boolean(item.excerpt || item.url || item.attachmentUrl);
  const Icon = SOURCE_META[item.source].Icon;

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-5 px-6 py-6">
          {item.excerpt ? (
            <p className="text-[1.0625rem] leading-relaxed whitespace-pre-wrap text-ink-200">
              {item.excerpt}
            </p>
          ) : (
            !hasBody && (
              <p className="flex items-center gap-2 text-[0.9375rem] text-ink-600 italic">
                <Icon className="h-4 w-4" /> No preview text with this capture.
              </p>
            )
          )}

          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-3 rounded-xl border border-white/8 bg-panel px-4 py-3 hover:bg-white/4 ${SIDEBAR_FOCUS}`}
            >
              <Globe className="h-4 w-4 flex-none text-ink-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] text-ink-100">
                  {domain ?? item.url}
                </span>
                <span className="block truncate text-[0.8125rem] text-ink-500">
                  {item.url}
                </span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 flex-none text-ink-500" />
            </a>
          )}

          {item.attachmentUrl && (
            // Plain <img>, deliberately not next/image — same-origin
            // attachment route (/api/uploads/[id]), same rationale as the
            // editor's ImageNode.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.attachmentUrl}
              alt={item.title}
              loading="lazy"
              className="max-h-[26rem] max-w-full self-start rounded-xl border border-white/10 object-contain"
            />
          )}

          {mode === "filed" ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-panel px-4 py-3 text-[0.9375rem] text-ink-300">
              <span className="flex-1">Filed today.</span>
              {item.filedNoteId && (
                <Link
                  href={`/app/notes/${item.filedNoteId}`}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-sage hover:bg-white/6 ${SIDEBAR_FOCUS}`}
                >
                  Open note <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          ) : (
            <section
              aria-label="File it"
              className="rounded-xl border border-white/8 bg-panel p-4"
            >
              <h2 className="mb-3 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
                File it
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {suggested && (
                  <Chip
                    icon={Folder}
                    selected={choice.kind === "suggested"}
                    onClick={() => onChoice({ kind: "suggested" })}
                  >
                    {suggested}
                  </Chip>
                )}
                {!suggested && (
                  <Chip
                    icon={NotebookPen}
                    selected={choice.kind === "note"}
                    onClick={() => onChoice({ kind: "note" })}
                  >
                    As a note
                  </Chip>
                )}
                {choice.kind === "folder" && (
                  <Chip icon={Folder} selected onClick={() => setPicker(true)}>
                    {choice.title}
                  </Chip>
                )}
                <div ref={pickerRef} className="relative">
                  <Chip
                    icon={Folder}
                    aria-haspopup="menu"
                    aria-expanded={picker}
                    onClick={() => setPicker((v) => !v)}
                    trailing={<ChevronDown className="h-3 w-3 text-ink-500" />}
                  >
                    Somewhere else…
                  </Chip>
                  {picker && (
                    <SomewhereElsePicker
                      onPick={(f) => {
                        setPicker(false);
                        onChoice(
                          f
                            ? { kind: "folder", bubbleId: f.id, title: f.title }
                            : { kind: "note" },
                        );
                      }}
                    />
                  )}
                </div>
                <Chip
                  icon={CheckSquare}
                  selected={choice.kind === "task"}
                  onClick={() => onChoice({ kind: "task" })}
                >
                  Make task
                </Chip>
                {person && (
                  <Link
                    href={`/app/people?person=${person.id}`}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/8 bg-white/4 px-3 text-[0.875rem] text-ink-300 hover:bg-white/8 hover:text-ink-100 touch:h-11 ${SIDEBAR_FOCUS}`}
                  >
                    <User className="h-3.5 w-3.5" />
                    {person.name}
                    <ArrowUpRight className="h-3 w-3 text-ink-500" />
                  </Link>
                )}
              </div>
              {item.suggestionReason && choice.kind === "suggested" && (
                <p className="mt-2.5 text-[0.8125rem] text-ink-600">
                  Suggested — {item.suggestionReason}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onAccept}
                  className={`flex h-9 items-center gap-1.5 rounded-lg bg-sage px-4 text-[0.9375rem] font-semibold text-sage-ink hover:brightness-105 touch:h-11 ${SIDEBAR_FOCUS}`}
                >
                  Accept
                  <span aria-hidden className="opacity-70 touch:hidden">
                    · ↵
                  </span>
                </button>

                {mode === "snoozed" ? (
                  <button
                    type="button"
                    onClick={onUnsnooze}
                    className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[0.9375rem] text-ink-400 hover:bg-white/6 hover:text-ink-100 touch:h-11 ${SIDEBAR_FOCUS}`}
                  >
                    <Clock className="h-3.5 w-3.5" /> Unsnooze
                  </button>
                ) : (
                  <div ref={snoozeRef} className="relative flex items-center">
                    <button
                      type="button"
                      onClick={() => onSnooze(snoozePresets(now)[1].until)}
                      title="Snooze until tomorrow 8:00 · S"
                      className={`flex h-9 items-center gap-1.5 rounded-l-lg pr-2 pl-3 text-[0.9375rem] text-ink-400 hover:bg-white/6 hover:text-ink-100 touch:h-11 ${SIDEBAR_FOCUS}`}
                    >
                      Snooze
                    </button>
                    <button
                      type="button"
                      aria-label="Snooze options"
                      aria-haspopup="menu"
                      aria-expanded={snoozeMenu}
                      onClick={() => setSnoozeMenu((v) => !v)}
                      className={`flex h-9 w-7 items-center justify-center rounded-r-lg text-ink-500 hover:bg-white/6 hover:text-ink-100 touch:h-11 touch:w-9 ${SIDEBAR_FOCUS}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {snoozeMenu && (
                      <div
                        role="menu"
                        className="absolute top-full left-0 z-40 mt-1 w-56 rounded-lg border border-white/8 bg-card py-1 shadow-xl"
                      >
                        {snoozePresets(now).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setSnoozeMenu(false);
                              onSnooze(p.until);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.875rem] text-ink-300 hover:bg-white/6 touch:min-h-11"
                          >
                            <span className="flex-1">{p.label}</span>
                            <span className="text-[0.75rem] text-ink-600">
                              {p.hint}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={onDismiss}
                  className={`ml-auto flex h-9 items-center gap-1.5 rounded-lg px-3 text-[0.875rem] text-ink-600 hover:bg-white/6 hover:text-ink-300 touch:h-11 ${SIDEBAR_FOCUS}`}
                >
                  <X className="h-3.5 w-3.5" /> Dismiss
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
