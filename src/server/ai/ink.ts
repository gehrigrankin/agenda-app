import "server-only";

import { z } from "zod";

import { aiStructured, isAiConfigured } from "./client";

/**
 * Ink block "Convert to text" (Notes Sidebars design §4a): transcribe a
 * rendered handwriting PNG. The client rasterizes the strokes dark-on-white;
 * the model returns the words line by line, or nothing when the block holds
 * a sketch rather than writing.
 */

const InkTextSchema = z.object({
  lines: z.array(z.string()),
});

export type InkTranscription =
  | { ok: true; lines: string[] }
  | { ok: false; reason: "not-configured" | "failed" | "empty" };

export async function transcribeInk(
  pngBase64: string,
): Promise<InkTranscription> {
  if (!isAiConfigured) return { ok: false, reason: "not-configured" };
  const result = await aiStructured({
    schema: InkTextSchema,
    maxTokens: 2000,
    effort: "low",
    images: [pngBase64],
    system: [
      "You transcribe handwriting from a note-taking app's ink block.",
      "Return the handwritten text exactly as written, one entry per written line, top to bottom, keeping the writer's spelling and abbreviations.",
      "Ignore drawings, arrows, underlines and doodles. If there is no legible writing, return an empty list. Never add commentary.",
    ].join(" "),
    prompt: "Transcribe the handwriting in this image.",
  });
  if (!result) return { ok: false, reason: "failed" };
  const lines = result.lines.map((l) => l.trim()).filter(Boolean);
  return lines.length ? { ok: true, lines } : { ok: false, reason: "empty" };
}
