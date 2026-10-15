"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/**
 * Chrome for the phone screens reached from the More drawer (Threads, People,
 * Inbox — design §6k–6o): a 3.5rem nav row with a sage "‹ Back" button on the
 * left and icon actions on the right, then a large page title. Same look as
 * the Notes phone screen. Phone only — callers wrap it in `md:hidden`.
 */

export const PHONE_ICON_BTN =
  "flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-300 outline-none transition-colors active:bg-white/8 focus-visible:ring-1 focus-visible:ring-sage/60 disabled:opacity-50";

export function PhoneNavRow({
  backLabel,
  onBack,
  trailing,
}: {
  backLabel: string;
  onBack: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-14 flex-none items-center gap-1 px-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={`Back to ${backLabel}`}
        className="flex h-11 min-w-0 items-center gap-0.5 rounded-lg pr-3 pl-1 text-[1rem] font-medium text-sage outline-none focus-visible:ring-1 focus-visible:ring-sage/60"
      >
        <ChevronLeft className="h-5 w-5 flex-none" />
        <span className="truncate">{backLabel}</span>
      </button>
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

export function PhoneTitle({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-none items-center gap-3 px-5 pt-1 pb-3">
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.75rem] leading-tight font-semibold text-ink-100">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-0.5 text-[0.8125rem] leading-snug text-ink-500">
            {subtitle}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}
