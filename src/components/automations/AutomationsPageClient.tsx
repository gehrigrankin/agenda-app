"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pause, Plus, Trash2, Wand2 } from "lucide-react";

import {
  createAutomationAction,
  deleteAutomationAction,
  getAiSettingsAction,
  listAutomationsAction,
  setAutomationEnabledAction,
  undoAutomationRunAction,
  type AutomationItem,
} from "@/app/app/ai/actions";

/**
 * Automations page (design Turn 14e): plain-language rules that run quietly
 * after you stop typing. Each rule shows what it last did, and every action
 * is an ordinary edit you can undo — no black box. The whole page is a
 * single panel matching the design's widget chrome: header bar, rule list,
 * new-rule row, explainer.
 */

const MIN_RULE_LENGTH = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

/** "today" for the local calendar day, else "Jul 6". */
function formatRunDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "today";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Best-effort weekly run count: automations whose last run fell in the
 * trailing 7 days. Undercounts (a rule may have run more than once this
 * week but only the latest run is loaded) — acceptable per design intent. */
function countRanThisWeek(items: AutomationItem[]): number {
  const now = Date.now();
  return items.filter(
    (a) => a.lastRun && now - new Date(a.lastRun.createdAt).getTime() <= WEEK_MS,
  ).length;
}

// ---------------------------------------------------------------------------
// iOS-style toggle
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[1.0625rem] w-[1.875rem] flex-none rounded-full transition-colors ${
        checked ? "bg-sage" : "bg-white/12"
      }`}
    >
      <span
        className={`absolute top-[0.125rem] h-[0.8125rem] w-[0.8125rem] rounded-full transition-[left,right,background-color] ${
          checked
            ? "right-[0.125rem] bg-sage-ink"
            : "left-[0.125rem] bg-ink-600"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// rule card
// ---------------------------------------------------------------------------

function AutomationRow({
  automation,
  onToggle,
  onDelete,
  onUndo,
}: {
  automation: AutomationItem;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onUndo: (runId: string) => void;
  }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { lastRun } = automation;

  return (
    <div
      onMouseLeave={() => setConfirmDelete(false)}
      className={`group rounded-[0.6875rem] border border-white/8 bg-white/2 px-[0.8125rem] py-[0.6875rem] ${
        automation.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-[0.5625rem]">
        <span className="min-w-0 flex-1 text-[0.78125rem] leading-[1.5] text-ink-200">
          {automation.rule}
        </span>
        {confirmDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="flex-none text-[0.65625rem] font-medium text-[#D9938A]"
          >
            Sure?
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Delete rule "${automation.rule}"`}
            onClick={() => setConfirmDelete(true)}
            className="flex-none text-ink-600 opacity-0 transition-opacity hover:text-[#D9938A] group-hover:opacity-100"
          >
            <Trash2 className="h-[0.8125rem] w-[0.8125rem]" />
          </button>
        )}
        <ToggleSwitch
          checked={automation.enabled}
          onChange={onToggle}
          label={`${automation.enabled ? "Disable" : "Enable"} rule "${automation.rule}"`}
        />
      </div>
      {!automation.enabled ? (
        <div className="mt-[0.4375rem] flex items-center gap-[0.375rem]">
          <Pause className="h-[0.625rem] w-[0.625rem] flex-none text-ink-400" />
          <span className="text-[0.65625rem] text-ink-600">paused</span>
        </div>
      ) : lastRun ? (
        <div className="mt-[0.4375rem] flex items-center gap-[0.375rem]">
          <Check className="h-[0.625rem] w-[0.625rem] flex-none text-sage" />
          <span className="min-w-0 truncate text-[0.65625rem] text-ink-600">
            last ran {formatRunDate(lastRun.createdAt)} · {lastRun.summary}
          </span>
          {lastRun.undoneAt ? (
            <span className="ml-auto flex-none text-[0.65625rem] font-medium text-ink-600">
              undone
            </span>
          ) : lastRun.canUndo ? (
            <button
              type="button"
              onClick={() => onUndo(lastRun.id)}
              className="ml-auto flex-none text-[0.65625rem] font-medium text-ink-400 hover:text-ink-300"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function AutomationsPageClient() {
  const [automations, setAutomations] = useState<AutomationItem[] | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  const [addingRule, setAddingRule] = useState(false);
  const [ruleDraft, setRuleDraft] = useState("");
  const [ruleError, setRuleError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAutomationsAction(), getAiSettingsAction()])
      .then(([items, settings]) => {
        if (cancelled) return;
        setAutomations(items);
        setAiConfigured(settings.aiConfigured);
      })
      .catch((err) => console.error("[automations] load failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (addingRule) inputRef.current?.focus();
  }, [addingRule]);

  const handleToggle = (id: string, enabled: boolean) => {
    setAutomations((prev) =>
      prev ? prev.map((a) => (a.id === id ? { ...a, enabled } : a)) : prev,
    );
    setAutomationEnabledAction(id, enabled).catch((err) => {
      console.error("[automations] toggle failed:", err);
      setAutomations((prev) =>
        prev ? prev.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)) : prev,
      );
    });
  };

  const handleDelete = (id: string) => {
    const prevAutomations = automations;
    setAutomations((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    deleteAutomationAction(id).catch((err) => {
      console.error("[automations] delete failed:", err);
      setAutomations(prevAutomations);
    });
  };

  const handleUndo = async (automationId: string, runId: string) => {
    try {
      const undone = await undoAutomationRunAction(runId);
      if (!undone) return;
      setAutomations((prev) =>
        prev
          ? prev.map((a) =>
              a.id === automationId && a.lastRun
                ? { ...a, lastRun: { ...a.lastRun, undoneAt: new Date().toISOString() } }
                : a,
            )
          : prev,
      );
    } catch (err) {
      console.error("[automations] undo failed:", err);
    }
  };

  const submitNewRule = async () => {
    const value = ruleDraft.trim();
    if (value.length < MIN_RULE_LENGTH) {
      setRuleError(true);
      return;
    }
    try {
      await createAutomationAction(value);
      const items = await listAutomationsAction();
      setAutomations(items);
      setRuleDraft("");
      setAddingRule(false);
      setRuleError(false);
    } catch (err) {
      console.error("[automations] create failed:", err);
      setRuleError(true);
    }
  };

  const cancelNewRule = () => {
    setAddingRule(false);
    setRuleDraft("");
    setRuleError(false);
  };

  const loading = automations === null || aiConfigured === null;
  const ranThisWeek = automations ? countRanThisWeek(automations) : 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-[46.25rem]">
        {aiConfigured === false && (
          <div className="mb-3 rounded-lg border border-[#D9938A]/25 bg-[#D9938A]/8 px-3 py-2 text-[0.71875rem] text-[#D9938A]">
            Automations need ANTHROPIC_API_KEY to run. Rules are saved but
            won&apos;t fire.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-white/9 bg-panel/95">
          {/* Header */}
          <div className="flex items-center gap-[0.5625rem] border-b border-white/7 px-[1.125rem] py-3">
            <Wand2 className="h-3.5 w-3.5 flex-none text-tan" />
            <span className="text-[0.84375rem] font-semibold text-ink-100">
              Automations
            </span>
            <span className="text-[0.6875rem] text-ink-600">
              {loading
                ? "loading…"
                : `${automations?.length ?? 0} rule${automations?.length === 1 ? "" : "s"} · ran ${ranThisWeek} time${ranThisWeek === 1 ? "" : "s"} this week`}
            </span>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-[0.375rem] p-[0.625rem]">
            {loading ? (
              <div className="flex flex-col gap-[0.375rem]">
                <div className="h-11 animate-pulse rounded-[0.6875rem] bg-white/3" />
                <div className="h-11 animate-pulse rounded-[0.6875rem] bg-white/3" />
              </div>
            ) : automations && automations.length === 0 && !addingRule ? (
              <div className="rounded-[0.6875rem] border border-white/8 bg-white/2 px-3 py-2.5 text-center text-[0.75rem] text-ink-600">
                No rules yet
              </div>
            ) : (
              automations?.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  onToggle={(enabled) => handleToggle(automation.id, enabled)}
                  onDelete={() => handleDelete(automation.id)}
                  onUndo={(runId) => void handleUndo(automation.id, runId)}
                />
              ))
            )}

            {!loading &&
              (addingRule ? (
                <div className="flex flex-col gap-1">
                  <input
                    ref={inputRef}
                    value={ruleDraft}
                    onChange={(e) => {
                      setRuleDraft(e.target.value);
                      if (ruleError) setRuleError(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitNewRule();
                      } else if (e.key === "Escape") {
                        cancelNewRule();
                      }
                    }}
                    onBlur={() => {
                      if (!ruleDraft.trim()) cancelNewRule();
                    }}
                    placeholder='e.g. "when I mention a person, link their note"'
                    className="w-full rounded-lg border border-white/7 bg-input px-3 py-2.5 text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-600"
                  />
                  {ruleError && (
                    <p className="px-1 text-[0.65625rem] text-[#D9938A]">
                      rules need at least {MIN_RULE_LENGTH} characters
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingRule(true)}
                  className="flex items-center gap-[0.5625rem] rounded-[0.6875rem] px-[0.8125rem] py-2.5 text-left text-ink-600 hover:bg-white/3"
                >
                  <Plus className="h-[0.8125rem] w-[0.8125rem] flex-none" />
                  <span className="text-[0.75rem]">
                    New rule — e.g. &quot;when I mention a person, link their
                    note&quot;
                  </span>
                </button>
              ))}

            {!loading && (
              <p className="mt-1 px-[0.8125rem] text-[0.65625rem] text-ink-600">
                Rules run quietly after you stop typing. Every action is an
                ordinary edit you can undo — no black box.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
