"use client";

import type { ReactNode } from "react";

import type { ChipTone, DuePill, SummaryChip } from "@/lib/agenda-today";
import { subjectColor } from "@/lib/subjects";

/**
 * Small printed pieces of the Today agenda (design "Today Agenda", Turns 6–7).
 * Sizes are the design's px over a 16px root, in rem, so the md+ density
 * scale (13–15px root, globals.css) shrinks them with the rest of the app.
 */

/** Uppercase mono label: SCHEDULE, TASKS, NOTES, SUBJECTS. */
export const SECTION_LABEL =
  "font-mono text-[0.65625rem] font-medium uppercase leading-none tracking-[0.0875rem] text-ink-350";

/** ‹ / › page arrow (40×44 hit). */
export function PageArrow({
  dir,
  onClick,
  label,
  large = false,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  label: string;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex flex-none items-center justify-center rounded-lg hover:bg-white/5 ${
        large ? "h-11 w-11" : "h-11 w-10"
      }`}
    >
      <span
        aria-hidden
        className={`block border-solid border-ink-400 ${
          large ? "h-[0.5625rem] w-[0.5625rem]" : "h-2 w-2"
        } ${
          dir === "prev"
            ? `${large ? "ml-1 border-b-2 border-l-2" : "ml-[0.1875rem] border-b-[1.5px] border-l-[1.5px]"} rotate-45`
            : `${large ? "mr-1 border-r-2 border-t-2" : "mr-[0.1875rem] border-r-[1.5px] border-t-[1.5px]"} rotate-45`
        }`}
      />
    </button>
  );
}

/** The small ⌄/⌃ at the end of a foldable header. */
export function FoldChevron({
  open,
  className = "border-ink-500",
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`mx-1 block h-[0.4375rem] w-[0.4375rem] flex-none border-b-[1.5px] border-r-[1.5px] border-solid ${className} ${
        open ? "-rotate-[135deg] translate-y-[0.125rem]" : "rotate-45 -translate-y-[0.0625rem]"
      }`}
    />
  );
}

/** "≡" — this item has notes of its own. */
export function NotesMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="Has notes"
      className={`inline-block h-[0.4375rem] w-[0.5625rem] flex-none border-y-[1.5px] border-solid border-ink-500 ${className}`}
    />
  );
}

export function SubjectDot({
  color,
  size = 6,
}: {
  color: string | null | undefined;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-block flex-none rounded-full"
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        background: subjectColor(color),
      }}
    />
  );
}

/** The check glyph drawn inside a filled box/circle. */
export function CheckGlyph({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims =
    size === "sm"
      ? "h-2 w-1 -mt-[0.125rem] border-b-2 border-r-2"
      : size === "lg"
        ? "h-[0.6875rem] w-1.5 -mt-[0.1875rem] border-b-2 border-r-2"
        : "h-2.5 w-[0.3125rem] -mt-[0.1875rem] border-b-2 border-r-2";
  return (
    <span
      aria-hidden
      className={`block rotate-45 border-solid border-sage-ink ${dims}`}
    />
  );
}

/** Square task checkbox: 20px visual, 28×44 hit. */
export function TaskCheckbox({
  checked,
  onToggle,
  label,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="-my-[0.1875rem] -ml-1 flex h-11 w-7 flex-none items-center justify-center disabled:cursor-default"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-[0.3125rem] ${
          checked ? "bg-sage" : "border-[1.5px] border-solid border-ink-700"
        }`}
      >
        {checked && <CheckGlyph />}
      </span>
    </button>
  );
}

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-white/6 text-ink-300",
  muted: "bg-white/6 text-ink-400",
  now: "bg-steel/12 text-steel",
  late: "bg-overdue/12 text-overdue",
  text: "bg-transparent text-ink-350",
};

/** Summary chips in a folded header or the writing-mode context bar. */
export function SummaryChips({
  chips,
  size = "sm",
}: {
  chips: SummaryChip[];
  size?: "sm" | "md";
}) {
  return (
    <span className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
      {chips.map((chip, i) => (
        <span
          key={i}
          className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-full font-medium ${
            size === "md"
              ? "h-[1.625rem] px-2.5 text-[0.75rem] leading-[1.625rem]"
              : "h-6 px-[0.5625rem] text-[0.71875rem] leading-6"
          } ${CHIP_TONES[chip.tone]} ${
            // Counts never shrink; the long text chip (a title, the note's
            // first line, now/next) takes the ellipsis instead.
            chip.tone === "text" || chip.tone === "now" ? "flex-[0_1_auto]" : "flex-none"
          }`}
        >
          {chip.text}
        </span>
      ))}
    </span>
  );
}

/** Due pill at the right of a task row. */
export function DuePillView({
  pill,
  done,
  wide,
}: {
  pill: DuePill;
  done: boolean;
  wide: boolean;
}) {
  const late = pill.tone === "late";
  let tone: string;
  if (late) {
    tone = done
      ? "border border-white/10 text-ink-600 line-through"
      : "border border-transparent bg-overdue/12 text-overdue";
  } else if (pill.tone === "today") {
    tone = `border border-transparent ${done ? "text-ink-600" : "text-ink-100"}`;
  } else {
    tone = "border border-transparent text-ink-400";
  }
  return (
    <span
      className={`flex-none whitespace-nowrap rounded px-1.5 py-1 text-center font-mono leading-none ${
        late ? "font-semibold" : "font-medium"
      } ${wide ? "min-w-12 text-[0.65625rem]" : "min-w-11 text-[0.625rem]"} ${tone}`}
    >
      {pill.text}
    </span>
  );
}

/** 44px round icon button (inbox, +) with an optional count badge. */
export function RoundButton({
  label,
  onClick,
  children,
  badge,
  href,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  badge?: number;
  href?: string;
}) {
  const className =
    "relative flex h-11 w-11 flex-none items-center justify-center rounded-full border border-white/8 bg-white/5 text-ink-300 hover:bg-white/8";
  const inner = (
    <>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-sage px-1 text-center text-[0.65625rem] font-semibold leading-[1.125rem] text-sage-ink">
          {badge}
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <a href={href} aria-label={label} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/** Ghost "Today" jump, shown whenever you've paged off today. */
export function TodayJump({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 flex-none items-center"
    >
      <span className="flex h-8 items-center rounded-full border-[1.5px] border-sage/60 px-3 text-[0.78125rem] font-semibold leading-none text-sage hover:bg-sage/8">
        Today
      </span>
    </button>
  );
}

export function Hairline() {
  return <span aria-hidden className="h-px min-w-3 flex-1 bg-white/8" />;
}
