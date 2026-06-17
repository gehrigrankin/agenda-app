"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";

import { createNoteAction } from "@/app/app/actions";

/**
 * Creates a note and navigates into it (the action redirects server-side).
 * `variant` switches between the compact sidebar button and a large empty-state
 * call to action.
 */
export function NewNoteButton({
  variant = "sidebar",
  onCreated,
}: {
  variant?: "sidebar" | "cta";
  onCreated?: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      await createNoteAction();
      onCreated?.();
    });

  if (variant === "cta") {
    return (
      <button
        type="button"
        onClick={create}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        <Plus className="h-4 w-4" />
        {isPending ? "Creating…" : "New note"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={isPending}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200/60 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Plus className="h-4 w-4" />
      {isPending ? "Creating…" : "New note"}
    </button>
  );
}
