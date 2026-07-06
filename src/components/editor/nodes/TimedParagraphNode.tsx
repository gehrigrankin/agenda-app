import {
  $applyNodeReplacement,
  ParagraphNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedParagraphNode,
  type Spread,
} from "lexical";

/**
 * Paragraph that knows WHEN its content was started — the unit of the daily
 * note's timeline. `timestamp` is an ISO instant (null until the block first
 * receives content; the TimestampPlugin stamps it), rendered as a time gutter
 * by CSS scoped to `.daily-gutter` — in any other surface these render as
 * plain paragraphs. `srcJotId` is set only by the jots migration script so
 * re-runs can skip already-migrated jots.
 *
 * Only the daily editor CREATES these (via TimestampPlugin / insertNewAfter);
 * the node itself is registered everywhere so any surface can render them.
 */

export type SerializedTimedParagraphNode = Spread<
  {
    timestamp: string | null;
    srcJotId: string | null;
  },
  SerializedParagraphNode
>;

/** "9:04" (client-local, no AM/PM — matches the design's gutter labels). */
export function formatTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s?(AM|PM)$/i, "");
}

export class TimedParagraphNode extends ParagraphNode {
  __timestamp: string | null;
  __srcJotId: string | null;

  static getType(): string {
    return "timed-paragraph";
  }

  static clone(node: TimedParagraphNode): TimedParagraphNode {
    return new TimedParagraphNode(node.__timestamp, node.__srcJotId, node.__key);
  }

  constructor(
    timestamp: string | null = null,
    srcJotId: string | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__timestamp = timestamp;
    this.__srcJotId = srcJotId;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(
    serializedNode: SerializedTimedParagraphNode,
  ): TimedParagraphNode {
    const node = $createTimedParagraphNode(
      typeof serializedNode.timestamp === "string"
        ? serializedNode.timestamp
        : null,
      typeof serializedNode.srcJotId === "string"
        ? serializedNode.srcJotId
        : null,
    );
    // Mirror ParagraphNode.importJSON's field restoration.
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    if (typeof serializedNode.textFormat === "number") {
      node.setTextFormat(serializedNode.textFormat);
    }
    if (typeof serializedNode.textStyle === "string") {
      node.setTextStyle(serializedNode.textStyle);
    }
    return node;
  }

  exportJSON(): SerializedTimedParagraphNode {
    return {
      ...super.exportJSON(),
      type: "timed-paragraph",
      version: 1,
      timestamp: this.__timestamp,
      srcJotId: this.__srcJotId,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add("timed-block");
    if (this.__timestamp) {
      dom.dataset.time = formatTimeLabel(this.__timestamp);
    }
    return dom;
  }

  updateDOM(
    prevNode: this,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate && prevNode.__timestamp !== this.__timestamp) {
      if (this.__timestamp) {
        dom.dataset.time = formatTimeLabel(this.__timestamp);
      } else {
        delete dom.dataset.time;
      }
    }
    return recreate;
  }

  getTimestamp(): string | null {
    return this.getLatest().__timestamp;
  }

  setTimestamp(timestamp: string | null): void {
    this.getWritable().__timestamp = timestamp;
  }

  /**
   * Enter inside the daily timeline continues it: the next block is timed too
   * (unstamped — the TimestampPlugin stamps it when content lands, so an
   * abandoned empty block never claims a time).
   */
  insertNewAfter(
    rangeSelection: RangeSelection,
    restoreSelection?: boolean,
  ): ParagraphNode {
    const newElement = $createTimedParagraphNode();
    newElement.setTextFormat(rangeSelection.format);
    newElement.setTextStyle(rangeSelection.style);
    newElement.setDirection(this.getDirection());
    newElement.setFormat(this.getFormatType());
    this.insertAfter(newElement, restoreSelection);
    return newElement;
  }
}

export function $createTimedParagraphNode(
  timestamp: string | null = null,
  srcJotId: string | null = null,
): TimedParagraphNode {
  return $applyNodeReplacement(new TimedParagraphNode(timestamp, srcJotId));
}

export function $isTimedParagraphNode(
  node: LexicalNode | null | undefined,
): node is TimedParagraphNode {
  return node instanceof TimedParagraphNode;
}
