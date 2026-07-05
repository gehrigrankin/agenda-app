"use client";

import { useRef } from "react";

/**
 * Text input whose commit/cancel fires exactly once. Enter (or blur) with a
 * non-empty value commits; Escape — or committing an empty value — cancels.
 * The `doneRef` latch matters because committing usually unmounts the input,
 * which fires a trailing blur that would otherwise submit a second time (or
 * turn an Escape into a commit).
 */
export function LatchedInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder?: string;
  className?: string;
}) {
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim()) onCommit();
    else onCancel();
  };

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}
