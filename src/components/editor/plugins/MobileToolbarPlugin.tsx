"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
} from "lexical";
import { Camera, Link, List, SquareCheck, Type } from "lucide-react";

import { $createTaskNode } from "../nodes/TaskNode";
import { normalizeUrl } from "./FloatingToolbarPlugin";
import { INSERT_IMAGE_COMMAND } from "./ImagePlugin";

/**
 * Phone-only formatting bar docked at the bottom of the editor pane
 * (mobile redesign, "Turn 17c"). Sits last in the editor's flex column so
 * browsers that resize the visual viewport push it up above the on-screen
 * keyboard, keeping tasks / lists / links / photos thumb-reachable. "Done"
 * blurs the editor, collapsing the iOS keyboard.
 *
 * Every button dispatches a command that is already registered in this
 * composer (ListPlugin, LinkPlugin, ImagePlugin, TaskNode) — this bar adds
 * no behavior of its own. `md:hidden` keeps desktop untouched; the Editor
 * only mounts it when the host opts in (full-page note view, never dock
 * windows or quick-view overlays).
 */
export function MobileToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  // Cycle the current block: paragraph → h1 → h2 → paragraph.
  const cycleBlockType = () => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchorNode = selection.anchor.getNode();
      const element = $isRootNode(anchorNode)
        ? null
        : anchorNode.getTopLevelElementOrThrow();
      const tag = $isHeadingNode(element) ? element.getTag() : null;
      if (tag === null) {
        $setBlocksType(selection, () => $createHeadingNode("h1"));
      } else if (tag === "h1") {
        $setBlocksType(selection, () => $createHeadingNode("h2"));
      } else {
        $setBlocksType(selection, () => $createParagraphNode());
      }
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

  return (
    <div
      className="flex items-center gap-0.5 border-t border-white/8 bg-bar px-2.5 py-1.5 md:hidden"
      // Keep taps from stealing focus off the editor — the keyboard must stay
      // up while formatting (Done blurs explicitly).
      onMouseDown={(e) => e.preventDefault()}
    >
      <BarButton label="Text style" onClick={cycleBlockType}>
        <Type className="h-[19px] w-[19px]" />
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
      <BarButton label="Link" onClick={toggleLink}>
        <Link className="h-[19px] w-[19px]" />
      </BarButton>
      <BarButton
        label="Add photo"
        onClick={() => editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined)}
      >
        <Camera className="h-[19px] w-[19px]" />
      </BarButton>
      <button
        type="button"
        onClick={() => editor.getRootElement()?.blur()}
        className="ml-auto rounded-[0.625rem] px-3 py-2 text-sm font-semibold text-sage active:bg-sage/14"
      >
        Done
      </button>
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
      className="flex h-11 w-11 items-center justify-center rounded-[0.625rem] text-ink-300 active:bg-sage/14 active:text-sage"
    >
      {children}
    </button>
  );
}
