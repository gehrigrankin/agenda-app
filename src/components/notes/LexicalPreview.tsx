"use client";

import { useState } from "react";
import type { SerializedEditorState } from "lexical";
import { Check } from "lucide-react";

import { toggleTaskAction } from "@/app/app/actions";

/**
 * Static renderer for serialized Lexical content — linked-note card bodies and
 * anywhere else a styled read-only preview is needed without mounting a full
 * editor. Renders the common block types; unknown nodes are skipped. Task
 * nodes are LIVE: their checkbox toggles the real task row (optimistic).
 */

type SNode = {
  type?: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  checked?: boolean;
  children?: SNode[];
  // task node fields
  taskId?: string | null;
  title?: string;
  completed?: boolean;
  // note-link fields
  noteId?: string;
  // timestamp fields exist on timed-paragraph but aren't rendered here
};

const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;
const IS_UNDERLINE = 8;
const IS_CODE = 16;

function TextRun({ node, i }: { node: SNode; i: number }) {
  const format = typeof node.format === "number" ? node.format : 0;
  let el: React.ReactNode = node.text ?? "";
  if (format & IS_CODE) {
    el = (
      <code key={i} className="rounded bg-white/8 px-1 font-mono text-[0.85em]">
        {el}
      </code>
    );
  }
  const classes = [
    format & IS_BOLD ? "font-semibold" : "",
    format & IS_ITALIC ? "italic" : "",
    format & IS_STRIKETHROUGH ? "line-through" : "",
    format & IS_UNDERLINE ? "underline" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!classes) return <span key={i}>{el}</span>;
  return (
    <span key={i} className={classes}>
      {el}
    </span>
  );
}

function InlineChildren({ nodes }: { nodes: SNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "text") return <TextRun key={i} node={n} i={i} />;
        if (n.type === "linebreak") return <br key={i} />;
        if (n.type === "note-link" || n.type === "linked-note-card") {
          return (
            <span key={i} className="text-steel">
              {n.title || "linked note"}
            </span>
          );
        }
        if (Array.isArray(n.children)) {
          return <InlineChildren key={i} nodes={n.children} />;
        }
        return null;
      })}
    </>
  );
}

/** Live task row: checkbox wired to the real task (optimistic). */
function TaskPreviewRow({ node }: { node: SNode }) {
  const [completed, setCompleted] = useState(node.completed === true);
  const taskId = typeof node.taskId === "string" ? node.taskId : null;

  const toggle = () => {
    if (!taskId) return;
    const next = !completed;
    setCompleted(next);
    toggleTaskAction(taskId, next).catch((err) => {
      console.error("[tasks] preview toggle failed:", err);
      setCompleted(!next);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!taskId}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={completed ? "Mark task incomplete" : "Mark task complete"}
        className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] ${
          completed ? "bg-sage" : "border-[1.5px] border-ink-700"
        } ${taskId ? "cursor-pointer" : ""}`}
      >
        {completed && <Check className="h-2 w-2 text-sage-ink" />}
      </button>
      <span
        className={`min-w-0 flex-1 truncate text-[13px] leading-[1.4] ${
          completed ? "text-ink-500 line-through" : "text-ink-200"
        }`}
      >
        {node.title || "Untitled task"}
      </span>
    </div>
  );
}

function PreviewBlock({ node }: { node: SNode }) {
  const kids = Array.isArray(node.children) ? node.children : [];
  switch (node.type) {
    case "paragraph":
    case "timed-paragraph":
      return (
        <p className="text-[13px] leading-normal text-ink-200">
          <InlineChildren nodes={kids} />
        </p>
      );
    case "heading": {
      const size =
        node.tag === "h1"
          ? "text-[15px]"
          : node.tag === "h2"
            ? "text-[14px]"
            : "text-[13px]";
      return (
        <p className={`${size} font-semibold text-ink-100`}>
          <InlineChildren nodes={kids} />
        </p>
      );
    }
    case "quote":
      return (
        <p className="border-l-2 border-white/15 pl-2.5 text-[13px] italic leading-normal text-ink-400">
          <InlineChildren nodes={kids} />
        </p>
      );
    case "list": {
      const isCheck = node.listType === "check";
      const isNumber = node.listType === "number";
      return (
        <div className="flex flex-col gap-1">
          {kids.map((item, i) => {
            if (isCheck) {
              const checked = item.checked === true;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] ${
                      checked ? "bg-sage" : "border-[1.5px] border-ink-700"
                    }`}
                  >
                    {checked && <Check className="h-2 w-2 text-sage-ink" />}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] ${
                      checked ? "text-ink-500 line-through" : "text-ink-200"
                    }`}
                  >
                    <InlineChildren
                      nodes={Array.isArray(item.children) ? item.children : []}
                    />
                  </span>
                </div>
              );
            }
            return (
              <div key={i} className="flex gap-2 text-[13px] text-ink-200">
                <span className="flex-none text-ink-500">
                  {isNumber ? `${i + 1}.` : "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <InlineChildren
                    nodes={Array.isArray(item.children) ? item.children : []}
                  />
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    case "task":
      return <TaskPreviewRow node={node} />;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-white/6 p-2 font-mono text-[11px] leading-normal text-ink-300">
          <InlineChildren nodes={kids} />
        </pre>
      );
    case "horizontalrule":
      return <hr className="border-t border-white/10" />;
    default:
      return null;
  }
}

export function LexicalPreview({
  state,
  maxBlocks = 6,
}: {
  state: SerializedEditorState | null;
  maxBlocks?: number;
}) {
  const root = state?.root as SNode | undefined;
  const blocks = (Array.isArray(root?.children) ? root.children : []).filter(
    // Skip empty paragraphs so the preview budget goes to real content.
    (b) =>
      !(
        (b.type === "paragraph" || b.type === "timed-paragraph") &&
        (!Array.isArray(b.children) || b.children.length === 0)
      ),
  );

  if (blocks.length === 0) {
    return <p className="text-[12px] italic text-ink-600">Empty note</p>;
  }

  const shown = blocks.slice(0, maxBlocks);
  const hidden = blocks.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((b, i) => (
        <PreviewBlock key={i} node={b} />
      ))}
      {hidden > 0 && (
        <p className="text-[10.5px] text-ink-600">
          + {hidden} more block{hidden === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
