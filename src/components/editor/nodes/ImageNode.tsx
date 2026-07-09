"use client";

import { useCallback, useEffect, type JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

/**
 * Image node. `src` points at an uploaded attachment (see /api/uploads);
 * `naturalWidth` is captured on first load so reloads can reserve layout
 * without waiting for the image.
 *
 * Images are block by default (top-level in the note), but an image dropped
 * inside a list row is created inline (`__inline`). Inline decorators get
 * native caret positions before/after them — arrow keys walk past, Tab still
 * indents the bullet, and Backspace/Delete beside the image removes it via
 * Lexical's own deleteCharacter handling — whereas a block decorator inside
 * an <li> traps the caret. Old serialized notes lack the `inline` field and
 * load as block, exactly as before.
 */

export type SerializedImageNode = Spread<
  {
    src: string;
    altText: string;
    naturalWidth?: number | null;
    inline?: boolean;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;
  __naturalWidth: number | null;
  __inline: boolean;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__naturalWidth,
      node.__inline,
      node.__key,
    );
  }

  constructor(
    src = "",
    altText = "",
    naturalWidth: number | null = null,
    inline = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__naturalWidth = naturalWidth;
    this.__inline = inline;
  }

  /** Tolerates missing/malformed fields so old or hand-edited JSON never throws. */
  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      src: typeof serializedNode.src === "string" ? serializedNode.src : "",
      altText:
        typeof serializedNode.altText === "string"
          ? serializedNode.altText
          : "",
      naturalWidth:
        typeof serializedNode.naturalWidth === "number"
          ? serializedNode.naturalWidth
          : null,
      inline: serializedNode.inline === true,
    });
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
      naturalWidth: this.__naturalWidth,
      inline: this.__inline,
    };
  }

  createDOM(): HTMLElement {
    if (this.__inline) {
      const el = document.createElement("span");
      el.className = "inline-block max-w-full align-bottom";
      return el;
    }
    const el = document.createElement("div");
    el.className = "my-2";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return this.__inline;
  }

  getTextContent(): string {
    return this.__altText;
  }

  getSrc(): string {
    return this.getLatest().__src;
  }

  getAltText(): string {
    return this.getLatest().__altText;
  }

  getNaturalWidth(): number | null {
    return this.getLatest().__naturalWidth;
  }

  setNaturalWidth(width: number | null): void {
    this.getWritable().__naturalWidth = width;
  }

  decorate(): JSX.Element {
    return (
      <ImageComponent
        nodeKey={this.__key}
        src={this.__src}
        altText={this.__altText}
        naturalWidth={this.__naturalWidth}
      />
    );
  }
}

export function $createImageNode(fields: {
  src: string;
  altText: string;
  naturalWidth?: number | null;
  inline?: boolean;
}): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(
      fields.src,
      fields.altText,
      fields.naturalWidth ?? null,
      fields.inline ?? false,
    ),
  );
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}

// ---------------------------------------------------------------------------
// React component: click selects the node; Backspace/Delete then removes it.
// This only covers the click-selected (NodeSelection) case — caret-adjacent
// deletion of inline images is Lexical's native deleteCharacter behavior and
// must not be intercepted here.
// ---------------------------------------------------------------------------

function ImageComponent({
  nodeKey,
  src,
  altText,
  naturalWidth,
}: {
  nodeKey: NodeKey;
  src: string;
  altText: string;
  naturalWidth: number | null;
}) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  const onDelete = useCallback(
    (event: KeyboardEvent) => {
      const selection = $getSelection();
      if (isSelected && $isNodeSelection(selection)) {
        event.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) node.remove();
        return true;
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, onDelete]);

  return (
    // Plain <img>, deliberately not next/image: uploads are same-origin under
    // /uploads/ and next/image would need loader/remote-pattern config for no
    // real win here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={altText}
      loading="lazy"
      draggable={false}
      onClick={() => {
        clearSelection();
        setSelected(true);
      }}
      onLoad={(e) => {
        // Capture the natural width once so future loads can reserve layout.
        const w = e.currentTarget.naturalWidth;
        if (naturalWidth === null && w > 0) {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isImageNode(node)) node.setNaturalWidth(w);
          });
        }
      }}
      style={naturalWidth ? { width: naturalWidth } : undefined}
      className={`max-w-full cursor-default rounded-lg border border-neutral-200 dark:border-neutral-800 ${
        isSelected ? "ring-2 ring-blue-500 ring-offset-1" : ""
      }`}
    />
  );
}
