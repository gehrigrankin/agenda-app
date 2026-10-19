"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The app's own alert / confirm / prompt — never the browser's. Callable from
 * anywhere (components, Lexical plugins, plain async code) as promises:
 *
 *   if (await confirmDialog({ title: "Delete “Run”?", destructive: true })) …
 *   const url = await promptDialog({ title: "Link URL" }); // null = cancelled
 *
 * A module-level queue feeds the one <DialogHost /> mounted in the root layout,
 * so callers need no context or provider. Dialogs show one at a time, in call
 * order. Esc or the backdrop cancels; Enter confirms.
 */

interface BaseOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

export interface ConfirmOptions extends BaseOptions {
  cancelLabel?: string;
  /** Red confirm button — deletes and other one-way actions. */
  destructive?: boolean;
}

export interface PromptOptions extends BaseOptions {
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  inputType?: "text" | "url";
}

type Request =
  | { id: number; kind: "alert"; opts: BaseOptions; resolve: (v: void) => void }
  | {
      id: number;
      kind: "confirm";
      opts: ConfirmOptions;
      resolve: (v: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      opts: PromptOptions;
      resolve: (v: string | null) => void;
    };

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function push(req: Request) {
  queue = [...queue, req];
  emit();
}

function settle(id: number) {
  queue = queue.filter((r) => r.id !== id);
  emit();
}

export function alertDialog(opts: BaseOptions): Promise<void> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "alert", opts, resolve }),
  );
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "confirm", opts, resolve }),
  );
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) =>
    push({ id: nextId++, kind: "prompt", opts, resolve }),
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => queue[0] ?? null;
const getServerSnapshot = () => null;

export function DialogHost() {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  // Keyed by id so each request gets fresh input state and focus handling.
  return current ? <DialogView key={current.id} req={current} /> : null;
}

function DialogView({ req }: { req: Request }) {
  const [value, setValue] = useState(
    req.kind === "prompt" ? (req.opts.defaultValue ?? "") : "",
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const close = (ok: boolean) => {
    settle(req.id);
    if (req.kind === "alert") req.resolve();
    else if (req.kind === "confirm") req.resolve(ok);
    else req.resolve(ok ? valueRef.current : null);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.select();
    } else {
      confirmRef.current?.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase + stop: an Esc here must not also close the sheet,
        // panel or editor mode underneath.
        e.preventDefault();
        e.stopPropagation();
        closeRef.current(false);
      } else if (e.key === "Tab" && panelRef.current) {
        // Keep focus inside the dialog.
        const items =
          panelRef.current.querySelectorAll<HTMLElement>("input, button");
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  const { title, message, confirmLabel } = req.opts;
  const cancelLabel =
    req.kind === "alert" ? null : (req.opts.cancelLabel ?? "Cancel");
  const destructive = req.kind === "confirm" && req.opts.destructive;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center sm:p-6"
      role={req.kind === "prompt" ? "dialog" : "alertdialog"}
      aria-modal="true"
      aria-labelledby={`dialog-${req.id}-title`}
      aria-describedby={message ? `dialog-${req.id}-message` : undefined}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => close(false)}
        className="animate-overlay-fade-in absolute inset-0 cursor-default bg-black/55"
      />
      <div
        ref={panelRef}
        className="agenda-sheet-in relative w-full max-w-sm rounded-2xl border border-white/10 bg-panel p-5 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
      >
        {/* noValidate: type="url" would otherwise block a bare "example.com",
            which the caller normalizes itself. */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            close(true);
          }}
        >
          <h2
            id={`dialog-${req.id}-title`}
            className="text-[0.9375rem] font-semibold text-ink-100"
          >
            {title}
          </h2>
          {message && (
            <p
              id={`dialog-${req.id}-message`}
              className="mt-1.5 text-sm leading-relaxed text-ink-400"
            >
              {message}
            </p>
          )}
          {req.kind === "prompt" && (
            <input
              ref={inputRef}
              type={req.opts.inputType ?? "text"}
              value={value}
              placeholder={req.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="mt-3 w-full rounded-xl border border-white/10 bg-input px-3 py-2.5 text-base text-ink-100 outline-none placeholder:text-ink-600 focus:border-sage/60 sm:text-sm"
            />
          )}
          <div className="mt-5 flex justify-end gap-2">
            {cancelLabel && (
              <button
                type="button"
                onClick={() => close(false)}
                className="min-h-10 rounded-xl px-4 text-sm font-medium text-ink-300 hover:bg-white/5"
              >
                {cancelLabel}
              </button>
            )}
            <button
              ref={confirmRef}
              type="submit"
              className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${
                destructive
                  ? "bg-overdue text-sage-ink hover:bg-overdue/90"
                  : "bg-sage text-sage-ink hover:bg-sage/90"
              }`}
            >
              {confirmLabel ??
                (req.kind === "alert" ? "OK" : destructive ? "Delete" : "OK")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
