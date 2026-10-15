"use client";

import type { JSX } from "react";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import {
  INK_DEFAULT_HEIGHT,
  INK_MAX_HEIGHT,
  INK_MIN_HEIGHT,
  parseStrokes,
  type InkStroke,
} from "@/lib/ink";

import { InkBlock } from "./InkBlock";

/**
 * Ink block (Notes Sidebars design §4a): a block of handwriting and sketches
 * inside a note. Strokes live in the node's JSON in a fixed 1000-unit-wide
 * space (see `src/lib/ink.ts`), so the drawing scales with the column. The
 * node is registered on every surface so any note can render one; inserting
 * new blocks is gated by the Labs flag (`useInkFlag`).
 */

export type SerializedInkNode = Spread<
  { strokes: InkStroke[]; height: number },
  SerializedLexicalNode
>;

const clampHeight = (h: unknown) =>
  typeof h === "number" && Number.isFinite(h)
    ? Math.min(INK_MAX_HEIGHT, Math.max(INK_MIN_HEIGHT, Math.round(h)))
    : INK_DEFAULT_HEIGHT;

export class InkNode extends DecoratorNode<JSX.Element> {
  __strokes: InkStroke[];
  __height: number;

  static getType(): string {
    return "ink";
  }

  static clone(node: InkNode): InkNode {
    return new InkNode(node.__strokes, node.__height, node.__key);
  }

  constructor(
    strokes: InkStroke[] = [],
    height = INK_DEFAULT_HEIGHT,
    key?: NodeKey,
  ) {
    super(key);
    this.__strokes = strokes;
    this.__height = height;
  }

  /** Malformed stroke data is dropped, never thrown on. */
  static importJSON(serialized: SerializedInkNode): InkNode {
    return $createInkNode(
      parseStrokes(serialized.strokes),
      clampHeight(serialized.height),
    );
  }

  exportJSON(): SerializedInkNode {
    return {
      ...super.exportJSON(),
      type: "ink",
      version: 1,
      strokes: this.__strokes,
      height: this.__height,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-3";
    el.contentEditable = "false";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return "";
  }

  setInk(strokes: InkStroke[], height: number): void {
    const self = this.getWritable();
    self.__strokes = strokes;
    self.__height = clampHeight(height);
  }

  decorate(): JSX.Element {
    return (
      <InkBlock
        nodeKey={this.__key}
        strokes={this.__strokes}
        height={this.__height}
      />
    );
  }
}

export function $createInkNode(
  strokes: InkStroke[] = [],
  height = INK_DEFAULT_HEIGHT,
): InkNode {
  return $applyNodeReplacement(new InkNode(strokes, height));
}

export function $isInkNode(
  node: LexicalNode | null | undefined,
): node is InkNode {
  return node instanceof InkNode;
}
