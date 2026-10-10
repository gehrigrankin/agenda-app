"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phone bottom sheet (Notes Sidebars design §4e/§4i/§6i): a grab handle, an
 * optional header, scrolling content, a dimmed backdrop. Tap the backdrop,
 * press Esc, or drag the sheet down past a threshold to close. Focus moves
 * into the sheet on open and returns on close.
 */
export function BottomSheet({
  label,
  header,
  onClose,
  children,
  className,
}: {
  /** Accessible name for the dialog. */
  label: string;
  header?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const drag = useRef<number | null>(null);
  // Read through a ref: callers pass inline closures, and re-running the
  // focus effect on every render would steal focus back to the first control.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>(
        "input, button:not([data-handle]), [href], textarea",
      )
      ?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="animate-overlay-fade-in absolute inset-0 cursor-default bg-black/55"
      />
      <div
        ref={ref}
        className={`agenda-sheet-in absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl border-t border-white/10 bg-panel pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_50px_rgba(0,0,0,0.5)] ${className ?? ""}`}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          data-handle
          className="flex flex-none touch-none justify-center pt-2.5 pb-1.5"
          onPointerDown={(e) => {
            drag.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            setDy(Math.max(0, e.clientY - drag.current));
          }}
          onPointerUp={() => {
            drag.current = null;
            if (dy > 90) onClose();
            else setDy(0);
          }}
        >
          <span className="h-1.5 w-10 rounded-full bg-white/20" />
        </div>
        {header && <div className="flex-none">{header}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
