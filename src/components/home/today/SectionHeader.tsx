"use client";

import type { ReactNode } from "react";

import type { SummaryChip } from "@/lib/agenda-today";

import { FoldChevron, Hairline, SECTION_LABEL, SummaryChips } from "./atoms";

/**
 * A foldable section's header. Open: LABEL ── count. Folded: LABEL plus the
 * summary chips (what's inside, in a line). Tapping the row folds/unfolds;
 * `action` (the + for adding a task) sits before the chevron and doesn't.
 */
export function SectionHeader({
  label,
  count,
  chips,
  open,
  onToggle,
  action,
  wide,
  id,
}: {
  label: string;
  count: string;
  chips: SummaryChip[];
  open: boolean;
  onToggle?: () => void;
  action?: ReactNode;
  wide: boolean;
  /** id of the region this header controls. */
  id?: string;
}) {
  const body = (
    <>
      <span className={`${SECTION_LABEL} flex-none`}>{label}</span>
      {open ? (
        <>
          <Hairline />
          {count && (
            <span className="flex-none font-mono text-[0.65625rem] font-medium leading-none text-ink-600">
              {count}
            </span>
          )}
        </>
      ) : (
        <SummaryChips chips={chips} />
      )}
    </>
  );
  const rowClass = `flex flex-none items-center gap-2.5 ${
    wide ? "min-h-11" : "mx-5 min-h-10"
  }`;
  if (!onToggle) {
    return (
      <div className={rowClass}>
        {body}
        {action}
      </div>
    );
  }
  return (
    <div className={rowClass}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        {body}
      </button>
      {open && action}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? `Fold ${label}` : `Unfold ${label}`}
        className="-mr-1 flex h-10 w-6 flex-none items-center justify-center"
      >
        <FoldChevron open={open} />
      </button>
    </div>
  );
}

/** The dashed round + in the Tasks header. */
export function HeaderAddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="-mx-1.5 flex h-10 w-10 flex-none items-center justify-center"
    >
      <span className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full border border-dashed border-sage/55 text-[1.125rem] font-light leading-none text-sage">
        +
      </span>
    </button>
  );
}
