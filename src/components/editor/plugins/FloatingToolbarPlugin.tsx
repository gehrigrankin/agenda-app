"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical";
import { Bold, Code, Italic, Link, Strikethrough, Underline } from "lucide-react";

interface ToolbarState {
  visible: boolean;
  top: number;
  left: number;
  formats: Record<string, boolean>;
  isLink: boolean;
}

const HIDDEN: ToolbarState = {
  visible: false,
  top: 0,
  left: 0,
  formats: {},
  isLink: false,
};

/**
 * Floating format toolbar that appears above a non-empty text selection.
 * Mirrors the inline-format commands (bold/italic/underline/strikethrough/code)
 * plus a quick link toggle.
 */
export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>(HIDDEN);
  const ref = useRef<HTMLDivElement | null>(null);

  const updateToolbar = useCallback(() => {
    const nativeSelection = window.getSelection();
    const rootElement = editor.getRootElement();

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        nativeSelection === null ||
        nativeSelection.rangeCount === 0 ||
        rootElement === null ||
        !rootElement.contains(nativeSelection.anchorNode) ||
        selection.getTextContent() === ""
      ) {
        setState((s) => (s.visible ? HIDDEN : s));
        return;
      }

      const rangeRect = nativeSelection.getRangeAt(0).getBoundingClientRect();

      const node = selection.anchor.getNode();
      const parent = node.getParent();
      const isLink = $isLinkNode(parent) || $isLinkNode(node);

      setState({
        visible: true,
        top: rangeRect.top - 44,
        left: rangeRect.left + rangeRect.width / 2,
        formats: {
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
        },
        isLink,
      });
    });
  }, [editor]);

  useEffect(() => {
    const onSelectionChange = () => updateToolbar();
    document.addEventListener("selectionchange", onSelectionChange);
    const unregister = editor.registerUpdateListener(() => updateToolbar());
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      unregister();
    };
  }, [editor, updateToolbar]);

  const format = (type: TextFormatType) =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);

  const toggleLink = () => {
    if (state.isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      const url = window.prompt("Link URL");
      if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }
  };

  if (!state.visible) return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: state.top,
        left: state.left,
        transform: "translateX(-50%)",
      }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      onMouseDown={(e) => e.preventDefault()}
    >
      <FmtButton active={state.formats.bold} onClick={() => format("bold")} label="Bold">
        <Bold className="h-4 w-4" />
      </FmtButton>
      <FmtButton active={state.formats.italic} onClick={() => format("italic")} label="Italic">
        <Italic className="h-4 w-4" />
      </FmtButton>
      <FmtButton
        active={state.formats.underline}
        onClick={() => format("underline")}
        label="Underline"
      >
        <Underline className="h-4 w-4" />
      </FmtButton>
      <FmtButton
        active={state.formats.strikethrough}
        onClick={() => format("strikethrough")}
        label="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </FmtButton>
      <FmtButton active={state.formats.code} onClick={() => format("code")} label="Inline code">
        <Code className="h-4 w-4" />
      </FmtButton>
      <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      <FmtButton active={state.isLink} onClick={toggleLink} label="Link">
        <Link className="h-4 w-4" />
      </FmtButton>
    </div>,
    document.body,
  );
}

function FmtButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded p-1.5 ${
        active
          ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
