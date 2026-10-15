"use client";

import { forwardRef, useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { usePersistentState } from "@/lib/hooks/use-persistent-state";

/**
 * Shared sidebar anatomy (Notes Sidebars design §1, "the contract, per page"):
 * every page sidebar uses the same 42px header, the same collapsible section
 * headers, and the same rows, so a sidebar on Tasks reads like one on Notes.
 *
 * Sizes are rem against the 13px md+ root (42px ≈ 3.25rem, 26–30px rows ≈
 * 2–2.3rem). Rows grow to ≥44px tap targets on coarse pointers (`touch:`).
 */

export const SIDEBAR_FOCUS =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sage/70";

/** 42px header: uppercase label, action icons, and (usually) the collapse toggle. */
export function SidebarHeader({
  label,
  actions,
  children,
}: {
  label?: React.ReactNode;
  actions?: React.ReactNode;
  /** Replaces the label, e.g. a filter field. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-[3.25rem] flex-none items-center gap-1 border-b border-white/6 pr-2 pl-4 touch:h-[3.75rem]">
      {children ?? (
        <h2 className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold tracking-[0.1em] text-ink-400 uppercase">
          {label}
        </h2>
      )}
      {actions && (
        <div className="flex flex-none items-center gap-0.5">{actions}</div>
      )}
    </div>
  );
}

/** Icon-only header/toolbar button. `label` is required — it's the aria-label. */
export const SidebarIconButton = forwardRef<
  HTMLButtonElement,
  {
    icon: LucideIcon;
    label: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    expanded?: boolean;
    className?: string;
  }
>(function SidebarIconButton(
  {
    icon: Icon,
    label,
    onClick,
    active,
    disabled,
    pressed,
    expanded,
    className,
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 flex-none items-center justify-center rounded-md transition-colors touch:h-11 touch:w-11 disabled:opacity-40 ${SIDEBAR_FOCUS} ${
        active
          ? "bg-sage/14 text-sage"
          : "text-ink-500 hover:bg-white/6 hover:text-ink-200"
      } ${className ?? ""}`}
    >
      <Icon className="h-[1.0625rem] w-[1.0625rem]" />
    </button>
  );
});

/**
 * Collapsible section: chevron, uppercase label, count. Open state persists
 * per `storageKey` when given (pages pass e.g. "tasks.lists").
 */
export function SidebarSection({
  label,
  count,
  actions,
  storageKey,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  grow = false,
  className,
  children,
}: {
  label: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  storageKey?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Take the remaining height (an IDE-style stacked pane with its own scroll). */
  grow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [stored, setStored] = usePersistentState<boolean>(
    `agenda.section.${storageKey ?? "_unkeyed"}`,
    defaultOpen,
    (v): v is boolean => typeof v === "boolean",
  );
  const [local, setLocal] = useState(defaultOpen);
  const open = openProp ?? (storageKey ? stored : local);
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp !== undefined) return;
    if (storageKey) setStored(v);
    else setLocal(v);
  };
  const bodyId = useId();
  return (
    <section
      className={`flex flex-col ${grow && open ? "min-h-0 flex-1" : "flex-none"} ${className ?? ""}`}
    >
      <div className="group/sec flex h-[2.25rem] flex-none items-center gap-1 pr-2 touch:h-[3.4rem]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className={`flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left ${SIDEBAR_FOCUS}`}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 flex-none text-ink-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-none text-ink-500" />
          )}
          <span className="truncate text-[0.75rem] font-semibold tracking-[0.1em] text-ink-400 uppercase">
            {label}
          </span>
          {count !== undefined && count !== null && (
            <span className="text-[0.75rem] text-ink-600 tabular-nums">
              {count}
            </span>
          )}
        </button>
        {actions && (
          <div className="flex flex-none items-center gap-0.5">{actions}</div>
        )}
      </div>
      {open && (
        <div
          id={bodyId}
          className={grow ? "min-h-0 flex-1 overflow-y-auto" : undefined}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * One navigable row. Active = tinted background + a 2px accent bar on the
 * left edge. Renders a Link with `href`, else a button.
 */
export function SidebarRow({
  icon: Icon,
  iconNode,
  label,
  sublabel,
  count,
  trailing,
  active,
  href,
  onClick,
  indent = 0,
  dim,
  title,
}: {
  icon?: LucideIcon;
  /** Custom leading visual (a color dot, an avatar). Wins over `icon`. */
  iconNode?: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  count?: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  /** Extra left indent in rem. */
  indent?: number;
  dim?: boolean;
  title?: string;
}) {
  const cls = `relative flex w-full items-center gap-2.5 pr-3 text-left transition-colors ${
    sublabel ? "min-h-[2.75rem] py-1.5" : "min-h-[2.3rem]"
  } touch:min-h-[3.4rem] ${SIDEBAR_FOCUS} ${
    active
      ? "bg-sage/13 text-ink-100"
      : `${dim ? "text-ink-500" : "text-ink-300"} hover:bg-white/4 hover:text-ink-100`
  }`;
  const body = (
    <>
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px] bg-sage"
        />
      )}
      {iconNode ??
        (Icon && (
          <Icon
            className={`h-4 w-4 flex-none ${active ? "text-sage" : "text-ink-500"}`}
          />
        ))}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.875rem] leading-tight">{label}</span>
        {sublabel && (
          <span className="truncate text-[0.75rem] leading-tight text-ink-500">
            {sublabel}
          </span>
        )}
      </span>
      {trailing}
      {count !== undefined && count !== null && (
        <span className="flex-none text-[0.75rem] text-ink-600 tabular-nums">
          {count}
        </span>
      )}
    </>
  );
  const style = { paddingLeft: `${1 + indent}rem` };
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        title={title}
        className={cls}
        style={style}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      title={title}
      className={cls}
      style={style}
    >
      {body}
    </button>
  );
}
