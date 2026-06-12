"use client";

import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  $createParagraphNode,
  type TextFormatType,
} from "lexical";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Pilcrow,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";

function ToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "rounded-md p-1.5 transition-colors",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      )}
    >
      <Icon size={16} />
    </button>
  );
}

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [formats, setFormats] = useState<Set<string>>(new Set());

  const refreshFormats = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const active = new Set<string>();
    for (const f of ["bold", "italic", "underline", "strikethrough", "code"] as const) {
      if (selection.hasFormat(f)) active.add(f);
    }
    setFormats(active);
  }, []);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        refreshFormats();
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, refreshFormats]);

  const format = (type: TextFormatType) =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);

  const setHeading = (tag: HeadingTagType) =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(tag));
      }
    });

  const setParagraph = () =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });

  const setQuote = () =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
      <ToolbarButton icon={Bold} label="Bold" active={formats.has("bold")} onClick={() => format("bold")} />
      <ToolbarButton icon={Italic} label="Italic" active={formats.has("italic")} onClick={() => format("italic")} />
      <ToolbarButton icon={Underline} label="Underline" active={formats.has("underline")} onClick={() => format("underline")} />
      <ToolbarButton icon={Strikethrough} label="Strikethrough" active={formats.has("strikethrough")} onClick={() => format("strikethrough")} />
      <ToolbarButton icon={Code} label="Inline code" active={formats.has("code")} onClick={() => format("code")} />
      <span className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <ToolbarButton icon={Pilcrow} label="Paragraph" onClick={setParagraph} />
      <ToolbarButton icon={Heading1} label="Heading 1" onClick={() => setHeading("h1")} />
      <ToolbarButton icon={Heading2} label="Heading 2" onClick={() => setHeading("h2")} />
      <ToolbarButton icon={Heading3} label="Heading 3" onClick={() => setHeading("h3")} />
      <span className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <ToolbarButton
        icon={List}
        label="Bullet list"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      />
      <ToolbarButton
        icon={ListOrdered}
        label="Numbered list"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      />
      <ToolbarButton icon={Quote} label="Quote" onClick={setQuote} />
    </div>
  );
}
