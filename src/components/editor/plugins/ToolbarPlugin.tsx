"use client";

import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from "@lexical/list";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  Bold,
  CheckSquare,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";

/**
 * Minimal foundation toolbar: history (undo/redo), inline formatting, headings,
 * and lists (incl. checklist). Note-links, image insert, and task-aware
 * controls are added as those nodes land in the MVP.
 */
export function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  const formatHeading = useCallback(
    (tag: HeadingTagType) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      });
    },
    [editor],
  );

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">
      <ToolbarButton
        label="Undo"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        onClick={() =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
        }
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton label="Heading 1" onClick={() => formatHeading("h1")}>
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" onClick={() => formatHeading("h2")}>
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Bulleted list"
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        onClick={() =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        }
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Checklist"
        onClick={() =>
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
        }
      >
        <CheckSquare className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1.5 text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />;
}
