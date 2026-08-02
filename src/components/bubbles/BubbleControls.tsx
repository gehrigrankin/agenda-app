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
      className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-10 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel/85 shadow-lg shadow-black/40 backdrop-blur-md"
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
  return <div aria-hidden className="mx-2 h-px bg-white/10" />;
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
      className="flex h-10 w-10 items-center justify-center text-ink-300 transition-colors duration-150 hover:bg-white/8 hover:text-ink-100 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" />
    </button>
  );
}
