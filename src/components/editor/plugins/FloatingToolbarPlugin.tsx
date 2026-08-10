"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
} from "@lexical/selection";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical";
import {
  Baseline,
  Bold,
  Code,
  Italic,
  Link,
  Strikethrough,
  Underline,
} from "lucide-react";

interface ToolbarState {
  visible: boolean;
  top: number;
  left: number;
  formats: Record<string, boolean>;
  isLink: boolean;
  /** CSS color on the selection, "" when it's the default ink. */
  color: string;
}

const HIDDEN: ToolbarState = {
  visible: false,
  top: 0,
  left: 0,
  formats: {},
  isLink: false,
  color: "",
};

const FORMAT_KEYS = ["bold", "italic", "underline", "strikethrough", "code"];

/**
 * Text colors, straight off the app's palette (globals.css `@theme`) plus two
 * complements. Deliberately a small fixed set rather than a picker: notes are
 * read in one dark theme, and arbitrary hexes are how a document ends up with
 * text nobody can read. "Default" clears the style instead of writing the ink
 * ramp's own value, so coloured text stays distinguishable from plain text.
 */
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Sage", value: "#9cc5ac" },
  { label: "Steel", value: "#9bb8ce" },
  { label: "Tan", value: "#cdaf9b" },
  { label: "Rose", value: "#d9938a" },
  { label: "Amber", value: "#d9bd8a" },
  { label: "Violet", value: "#b3a5d6" },
];

// Approximate half-width of the toolbar, for clamping inside the viewport
// without a measure pass.
const TOOLBAR_HALF_WIDTH = 120;
const TOOLBAR_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;

function statesEqual(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.visible === b.visible &&
    a.top === b.top &&
    a.left === b.left &&
    a.isLink === b.isLink &&
    a.color === b.color &&
    FORMAT_KEYS.every((k) => a.formats[k] === b.formats[k])
  );
}

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Trim, require a safe protocol, and default bare hosts to https://. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return /^[\w-]+(\.[\w-]+)+/.test(trimmed) ? `https://${trimmed}` : null;
  }
}

/**
 * Floating format toolbar that appears above a non-empty text selection.
 * Mirrors the inline-format commands (bold/italic/underline/strikethrough/code)
 * plus a text-color swatch row and a quick link toggle.
 *
 * Color is a node STYLE (`$patchStyleText`), not a format bit: Lexical's
 * formats are a fixed bitmask with no room for one, and a style survives
 * serialization on the text node itself, so a coloured run keeps its colour
 * through save/reload and through markdown export as plain text.
 */
export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>(HIDDEN);
  const [colorOpen, setColorOpen] = useState(false);
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

      // Prefer above the selection; flip below when there's no room, and keep
      // the toolbar horizontally inside the viewport.
      const rawTop = rangeRect.top - TOOLBAR_HEIGHT;
      const top =
        rawTop < VIEWPORT_MARGIN ? rangeRect.bottom + VIEWPORT_MARGIN : rawTop;
      const left = Math.min(
        Math.max(
          rangeRect.left + rangeRect.width / 2,
          VIEWPORT_MARGIN + TOOLBAR_HALF_WIDTH,
        ),
        window.innerWidth - VIEWPORT_MARGIN - TOOLBAR_HALF_WIDTH,
      );

      const next: ToolbarState = {
        visible: true,
        top,
        left,
        formats: {
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
        },
        isLink,
        color: $getSelectionStyleValueForProperty(selection, "color", ""),
      };
      // Bail out when nothing changed so caret moves don't re-render the
      // portal on every selectionchange event.
      setState((s) => (statesEqual(s, next) ? s : next));
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

  // The swatch row is part of the toolbar, so it has to go when the toolbar
  // does — otherwise it reopens with the next selection.
  useEffect(() => {
    if (!state.visible) setColorOpen(false);
  }, [state.visible]);

  const format = (type: TextFormatType) =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);

  const applyColor = (value: string) => {
    editor.update(() => {
      const selection = $getSelection();
      // null, not "": an empty value would leave a dead `color:;` declaration
      // on every run the user ever reset.
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { color: value === "" ? null : value });
      }
    });
    setColorOpen(false);
  };

  const toggleLink = () => {
    if (state.isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      const url = window.prompt("Link URL");
      if (!url) return;
      const normalized = normalizeUrl(url);
      if (normalized) editor.dispatchCommand(TOGGLE_LINK_COMMAND, normalized);
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
      className="z-50 flex items-center gap-0.5 rounded-lg border border-white/8 bg-card p-1 shadow-lg"
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
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      <FmtButton
        active={colorOpen || state.color !== ""}
        onClick={() => setColorOpen((v) => !v)}
        label="Text color"
      >
        <Baseline
          className="h-4 w-4"
          // The icon's own bar carries the current color, so the button says
          // which color is armed without a second swatch chip.
          style={state.color ? { color: state.color } : undefined}
        />
      </FmtButton>
      <FmtButton active={state.isLink} onClick={toggleLink} label="Link">
        <Link className="h-4 w-4" />
      </FmtButton>

      {colorOpen && (
        // Below the toolbar, which itself may already have flipped below the
        // selection — either way the swatches hang off the bar, not the text.
        <div className="absolute left-1/2 top-full mt-1 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/8 bg-card p-1 shadow-lg">
          {TEXT_COLORS.map((c) => {
            const active = state.color.toLowerCase() === c.value.toLowerCase();
            return (
              <button
                key={c.label}
                type="button"
                aria-label={c.label}
                title={c.label}
                onClick={() => applyColor(c.value)}
                className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                  active ? "border-ink-100" : "border-white/15 hover:border-white/40"
                }`}
                style={c.value ? { background: c.value } : undefined}
              >
                {/* "Default" gets a letter rather than a swatch — it removes a
                    color, and a grey circle would read as one more choice. */}
                {c.value === "" && (
                  <span className="text-[0.625rem] font-semibold leading-none text-ink-300">
                    A
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
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
          ? "bg-white/15 text-ink-100"
          : "text-ink-300 hover:bg-white/8"
      }`}
    >
      {children}
    </button>
  );
}
