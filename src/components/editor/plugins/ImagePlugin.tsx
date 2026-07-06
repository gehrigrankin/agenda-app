"use client";

import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  PASTE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";

import { $createImageNode } from "../nodes/ImageNode";

/**
 * Image insertion flows: the slash menu dispatches INSERT_IMAGE_COMMAND (this
 * plugin opens its hidden file input), and pasting an image from the clipboard
 * uploads it directly. Both paths POST to /api/uploads and insert an ImageNode
 * with the returned URL. No optimistic placeholder for MVP — the image appears
 * when the upload finishes. Upload failures are log-only (console.error,
 * nothing inserted); a visible error surface is post-MVP since the app has no
 * toast system yet.
 */
export const INSERT_IMAGE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_IMAGE_COMMAND",
);

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // keep in sync with /api/uploads

async function uploadAndInsert(editor: LexicalEditor, file: File) {
  if (!file.type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) {
    console.error("[images] rejected: must be an image up to 3 MB");
    return;
  }
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: formData });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Upload failed (${res.status})`);
    }
    const { url, altText } = (await res.json()) as {
      url: string;
      altText: string;
    };
    editor.update(() => {
      // Falls back to appending at the root if the selection is gone by the
      // time the upload settles.
      $insertNodeToNearestRoot($createImageNode({ src: url, altText }));
    });
  } catch (err) {
    console.error("[images] upload failed:", err);
  }
}

export function ImagePlugin() {
  const [editor] = useLexicalComposerContext();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      () => {
        inputRef.current?.click();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  // Clipboard images (screenshots, copied images) upload on paste. Text-only
  // pastes fall through to Lexical's default handling. Priority must outrank
  // COMMAND_PRIORITY_EDITOR: RichTextPlugin registers PASTE_COMMAND there and
  // returns true unconditionally, which swallowed same-priority handlers.
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (f) => f.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) void uploadAndInsert(editor, file);
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-fires the change event.
    e.target.value = "";
    if (!file) return;
    void uploadAndInsert(editor, file);
  };

  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={onFileChange}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
