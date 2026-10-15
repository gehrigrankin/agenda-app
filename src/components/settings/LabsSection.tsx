"use client";

import { PenLine } from "lucide-react";

import { useInkFlag } from "@/lib/hooks/use-ink-flag";

/** Settings › Labs: features that ship behind a per-device flag. */
export function LabsSection() {
  const [ink, setInk] = useInkFlag();
  return (
    <div className="mt-5">
      <span className="px-1 text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
        Labs
      </span>
      <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
        <label className="flex min-h-[3.25rem] cursor-pointer items-center gap-3 px-3.5 py-3">
          <PenLine className="h-[1.0625rem] w-[1.0625rem] flex-none text-ink-400" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.875rem] font-medium text-ink-200">
              Ink blocks
            </span>
            <span className="text-[0.71875rem] leading-relaxed text-ink-600">
              Handwriting and sketches in notes (/ink, or the pen in the
              toolbar). Best with Apple Pencil; on iPad, Scribble already writes
              text into any line.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={ink}
            onChange={(e) => setInk(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-6 w-10 flex-none rounded-full bg-white/12 transition-colors peer-checked:bg-sage peer-focus-visible:outline-2 peer-focus-visible:outline-sage/70 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-ink-100 after:transition-transform peer-checked:after:translate-x-4"
          />
        </label>
      </div>
    </div>
  );
}
