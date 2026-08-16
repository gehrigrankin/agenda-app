"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  Bold,
  Camera,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Link,
  List,
  MoreHorizontal,
  SquareCheck,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { $createTaskNode } from "../nodes/TaskNode";
import { normalizeUrl } from "./FloatingToolbarPlugin";
import { INSERT_IMAGE_COMMAND } from "./ImagePlugin";

/**
 * Phone-only formatting bar docked at the bottom of the editor pane
 * (mobile redesign, "Turn 17c"). Sits last in the editor's flex column so
 * browsers that resize the visual viewport push it up above the on-screen
 * keyboard, keeping tasks / lists / links / photos thumb-reachable.
 *
 * Every button dispatches a command that is already registered in this
 * composer (ListPlugin, LinkPlugin, ImagePlugin, TaskNode) — this bar adds
 * no behavior of its own. `md:hidden` keeps desktop untouched; the Editor
 * only mounts it when the host opts in (full-page note view, never dock
 * windows or quick-view overlays).
 */
export function MobileToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      setKeyboardInset(inset > 100 ? inset : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  const setHeading = (tag: "h1" | "h2" | "h3") => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => $createHeadingNode(tag));
    });
  };

  const insertNoteLink = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText("[[");
    });
  };

  // A real task row (backed by the tasks table), same as the slash menu.
  const insertTask = () => {
    editor.update(() => {
      $insertNodeToNearestRoot($createTaskNode({}));
    });
  };

  // Same flow as the floating selection toolbar: unlink when the caret is in
  // a link, otherwise prompt for a URL and toggle it onto the selection.
  const toggleLink = () => {
    let isLink = false;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const node = selection.anchor.getNode();
        isLink = $isLinkNode(node) || $isLinkNode(node.getParent());
      }
    });
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const url = window.prompt("Link URL");
    if (!url) return;
    const normalized = normalizeUrl(url);
    if (normalized) editor.dispatchCommand(TOGGLE_LINK_COMMAND, normalized);
  };

  if (keyboardInset === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-50 flex items-center border-t border-white/8 bg-bar px-1.5 py-1.5 md:hidden"
      style={{ bottom: keyboardInset }}
      // Keep taps from stealing focus off the editor — the keyboard must stay
      // up while formatting.
      onMouseDown={(e) => e.preventDefault()}
    >
      <BarButton
        label="Undo"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2 className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton
        label="Bold"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton label="Heading 1" onClick={() => setHeading("h1")}>
        <Heading1 className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton label="Heading 2" onClick={() => setHeading("h2")}>
        <Heading2 className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton label="Heading 3" onClick={() => setHeading("h3")}>
        <Heading3 className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton label="Insert task" onClick={insertTask}>
        <SquareCheck className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton
        label="Bulleted list"
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        <List className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton label="Link to note" onClick={insertNoteLink}>
        <FileText className="h-[19px] w-[19px]" />
      </BarButton>
      <div className="relative flex min-w-0 flex-1">
        <BarButton
          label="More formatting"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal className="h-[19px] w-[19px]" />
        </BarButton>
        {moreOpen && (
          <div className="absolute bottom-full right-0 mb-2 flex rounded-xl border border-white/10 bg-bar p-1 shadow-xl">
            <BarButton label="Web link" onClick={toggleLink}>
              <Link className="h-[19px] w-[19px]" />
            </BarButton>
            <BarButton
              label="Add photo"
              onClick={() =>
                editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined)
              }
            >
              <Camera className="h-[19px] w-[19px]" />
            </BarButton>
          </div>
        )}
      </div>
    </div>
  );
}

function BarButton({
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
      className="flex h-11 w-11 min-w-0 flex-1 items-center justify-center rounded-xl text-ink-300 active:bg-sage/14 active:text-sage"
    >
      {children}
    </button>
  );
}
