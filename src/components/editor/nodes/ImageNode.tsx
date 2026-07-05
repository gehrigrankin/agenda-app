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
 * Block image node. `src` points at an uploaded attachment (see
 * /api/uploads); `naturalWidth` is captured on first load so reloads can
 * reserve layout without waiting for the image.
 */

export type SerializedImageNode = Spread<
  {
    src: string;
    altText: string;
    naturalWidth?: number | null;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;
  __naturalWidth: number | null;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__naturalWidth,
      node.__key,
    );
  }

  constructor(
    src = "",
    altText = "",
    naturalWidth: number | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__naturalWidth = naturalWidth;
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
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-2";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return this.__altText;
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
}): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(fields.src, fields.altText, fields.naturalWidth ?? null),
  );
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}

// ---------------------------------------------------------------------------
// React component: click selects the node; Backspace/Delete then removes it.
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
