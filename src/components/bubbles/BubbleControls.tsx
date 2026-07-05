"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronUp, Home, Maximize2, Minus, Plus } from "lucide-react";

/**
 * Floating navigation cluster for the bubble canvas: zoom in/out, fit the
 * focused bubble, go up one level, and jump home to the root. Rendered inside
 * the canvas container (bottom-right). `onPointerDown` stops propagation so
 * presses on the cluster never start a canvas pan or register as a tap.
 */
export function BubbleControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onUp,
  onHome,
  canGoUp,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onUp: () => void;
  onHome: () => void;
  canGoUp: boolean;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-4 right-4 z-10 flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/85 shadow-lg shadow-neutral-900/10 backdrop-blur-md dark:border-neutral-700/80 dark:bg-neutral-900/85 dark:shadow-black/40"
    >
      <ControlButton Icon={Plus} label="Zoom in" onClick={onZoomIn} />
      <ControlButton Icon={Minus} label="Zoom out" onClick={onZoomOut} />
      <Divider />
      <ControlButton Icon={Maximize2} label="Fit focused bubble" onClick={onFit} />
      <ControlButton
        Icon={ChevronUp}
        label="Up one level"
        onClick={onUp}
        disabled={!canGoUp}
      />
      <ControlButton Icon={Home} label="Go to root bubble" onClick={onHome} />
    </div>
  );
}

function Divider() {
  return <div aria-hidden className="mx-2 h-px bg-neutral-200 dark:bg-neutral-700" />;
}

function ControlButton({
  Icon,
  label,
  onClick,
  disabled,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 active:bg-neutral-200 disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:active:bg-neutral-700"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
