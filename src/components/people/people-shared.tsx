"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Check, Loader2, Plus, Star, X } from "lucide-react";

import type {
  PersonCommitmentItem,
  PersonDetailResult,
  PersonListItem,
  PersonMentionItem,
} from "@/app/app/people/actions";
import { formatTodayElseDate } from "@/lib/dates";

/**
 * Pieces shared by the phone and desktop trees of the People page: date
 * formatting, the avatar, the add-a-person input, the owe/owed commitment
 * lists and the contact editor.
 */

/** "Today" for the local calendar day, else "Tue, Jul 8" (+ year if not current). */
export function formatTalkedDate(iso: string, todayStr: string | null): string {
  return formatTodayElseDate(iso, todayStr, { weekday: true });
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function ContactAvatar({
  person,
  size = "h-9 w-9",
}: {
  person: Pick<PersonListItem, "name" | "photoUrl">;
  size?: string;
}) {
  return person.photoUrl ? (
    <Image
      unoptimized
      src={person.photoUrl}
      alt=""
      width={48}
      height={48}
      className={`${size} flex-none rounded-full object-cover ring-1 ring-white/10`}
    />
  ) : (
    <span
      className={`flex ${size} flex-none items-center justify-center rounded-full bg-gradient-to-br from-sage/25 to-steel/15 font-semibold text-sage ring-1 ring-white/8`}
    >
      {initial(person.name)}
    </span>
  );
}

export function sourceLabel(mention: PersonMentionItem): string {
  return mention.noteDailyDate ? "daily note" : mention.noteTitle || "Untitled";
}

// ---------------------------------------------------------------------------
// add-a-person input
// ---------------------------------------------------------------------------

export function NewPersonInput({
  onCreate,
  autoFocus,
}: {
  onCreate: (name: string) => Promise<void>;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-input px-2.5 py-2">
      <Plus className="h-3.5 w-3.5 flex-none text-ink-600" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Add a person…"
        className="min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600"
      />
      {busy && (
        <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-ink-500" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// detail pane — owe / owed columns
// ---------------------------------------------------------------------------

export function CommitmentRow({
  commitment,
  onToggle,
  onDelete,
}: {
  commitment: PersonCommitmentItem;
  onToggle: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const resolved = Boolean(commitment.resolvedAt);
  return (
    <div
      className={`group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
        resolved
          ? "border-white/6 opacity-50"
          : "border-white/8 bg-white/[0.03]"
      }`}
    >
      <button
        type="button"
        aria-label={resolved ? "Mark unresolved" : "Mark resolved"}
        onClick={() => onToggle(commitment.id, !resolved)}
        className={`mt-0.5 flex h-[0.9375rem] w-[0.9375rem] flex-none items-center justify-center rounded-[0.25rem] border-[1.5px] ${
          resolved ? "border-sage bg-sage" : "border-white/25 hover:bg-white/10"
        }`}
      >
        {resolved && <Check className="h-2.5 w-2.5 text-sage-ink" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[0.78125rem] ${
            resolved ? "strike-muted text-ink-600 line-through" : "text-ink-200"
          }`}
        >
          {commitment.text}
        </p>
        {commitment.contextLabel && (
          <p className="mt-0.5 text-[0.625rem] text-ink-600">
            {commitment.contextLabel}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Remove"
        onClick={() => onDelete(commitment.id)}
        className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded text-ink-700 hover:text-ink-300 md:opacity-0 md:group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** One "you owe / they owe" column with an inline add row — manual, no AI. */
export function OweSection({
  title,
  icon: Icon,
  colorClass,
  items,
  onToggle,
  onDelete,
  onAdd,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  colorClass: string;
  items: PersonCommitmentItem[];
  onToggle: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };
  return (
    <div className="min-w-0 flex-1">
      <div
        className={`flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${colorClass}`}
      >
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {items.map((c) => (
          <CommitmentRow
            key={c.id}
            commitment={c}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
        <div className="flex items-center gap-2 rounded-lg border border-white/6 bg-input px-2.5 py-1.5">
          <Plus className="h-3 w-3 flex-none text-ink-700" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add an item…"
            className="min-w-0 flex-1 bg-transparent text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-700"
          />
        </div>
      </div>
    </div>
  );
}

export function ContactEditor({
  person,
  onCancel,
  onSave,
  className = "border-b border-white/7 bg-white/[0.025] p-4",
}: {
  /** Wrapper classes — the phone page frames it as a band, the About card flush. */
  className?: string;
  person: PersonDetailResult;
  onCancel: () => void;
  onSave: (draft: {
    name: string;
    phone: string;
    email: string;
    photoUrl: string | null;
    isFavorite: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [email, setEmail] = useState(person.email ?? "");
  const [favorite, setFavorite] = useState(person.isFavorite);
  const [saving, setSaving] = useState(false);
  const fieldClass =
    "w-full rounded-lg border border-white/8 bg-input px-3 py-2 text-[0.78125rem] text-ink-100 outline-none focus:border-sage/45";
  return (
    <div className={className}>
      <div className="mx-auto grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="text-[0.65625rem] font-medium uppercase tracking-wide text-ink-600 sm:col-span-2">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1 ${fieldClass}`}
          />
        </label>
        <label className="text-[0.65625rem] font-medium uppercase tracking-wide text-ink-600">
          Phone
          <input
            value={phone}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            className={`mt-1 ${fieldClass}`}
          />
        </label>
        <label className="text-[0.65625rem] font-medium uppercase tracking-wide text-ink-600">
          Email
          <input
            value={email}
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1 ${fieldClass}`}
          />
        </label>
        <button
          type="button"
          onClick={() => setFavorite((v) => !v)}
          className="flex items-center gap-2 text-[0.75rem] text-ink-300"
        >
          <Star
            className={`h-4 w-4 ${favorite ? "fill-[#D6B36A] text-[#D6B36A]" : "text-ink-600"}`}
          />{" "}
          Favorite
        </button>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-[0.75rem] text-ink-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => {
              setSaving(true);
              void onSave({
                name,
                phone,
                email,
                photoUrl: person.photoUrl,
                isFavorite: favorite,
              }).finally(() => setSaving(false));
            }}
            className="rounded-lg bg-sage px-3 py-2 text-[0.75rem] font-semibold text-sage-ink disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
