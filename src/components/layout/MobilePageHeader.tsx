import type { ReactNode } from "react";

/**
 * Shared phone chrome for top-level app destinations. Today established the
 * pattern: a compact, calm bar with the page identity centered and one large
 * trailing action. Desktop pages keep their denser, feature-specific headers.
 */
export function MobilePageHeader({
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
    <header className="grid min-h-[4.125rem] flex-none grid-cols-[2.75rem_1fr_2.75rem] items-center border-b border-white/6 bg-bar px-3 pb-2.5 pt-3 md:hidden">
      <div className="flex min-w-0 items-center justify-start">{leading}</div>
      <div className="min-w-0 text-center">
        <h1 className="truncate text-[1rem] font-semibold leading-tight text-ink-100">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-0.5 truncate text-[0.65625rem] leading-tight text-ink-600">
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end">{trailing}</div>
    </header>
  );
}

export const MOBILE_HEADER_ACTION =
  "flex h-11 w-11 items-center justify-center rounded-full text-ink-300 transition-colors active:bg-white/8 disabled:opacity-50";
