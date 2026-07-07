import "server-only";

import { z } from "zod";

import { listFolderBubbles } from "@/server/bubbles";
import { aiStructured, isAiConfigured } from "./client";

/**
 * Destination suggestion for a capture-inbox item (design 16c): given an
 * item's title/excerpt, pick the single best-fitting folder bubble (or none)
 * so the inbox card can offer "File to <board>" as a one-tap accept. Cheap by
 * design — this runs once per seeded/ingested item, not on every page view.
 *
 * Falls back to a keyword-overlap heuristic when AI is unconfigured (or
 * declines/fails), so the feature works with zero setup — the same
 * degrade-gracefully contract as every other AI entry point in the app.
 */

export interface SuggestedDestination {
  bubbleId: string;
  /** Card button label, e.g. "File to Launch checklist". */
  label: string;
  /** Short justification shown next to the button, e.g. "mentioned in 3 notes". */
  reason: string;
}

const SuggestionSchema = z.object({
  // Verbatim folder title from the candidate list, or null if nothing fits.
  folderTitle: z.string().nullable(),
  reason: z.string().nullable(),
});

/** Best-effort match of a captured item to one of the owner's folder bubbles. */
export async function suggestDestination(
  ownerId: string,
  input: { title: string; excerpt: string | null },
): Promise<SuggestedDestination | null> {
  const folders = await listFolderBubbles(ownerId);
  if (folders.length === 0) return null;

  if (isAiConfigured) {
    const result = await aiStructured({
      system:
        "You file a captured item (forwarded email, shared link, or texted photo) into the single best-fitting folder from a fixed list, or none if nothing clearly fits. Never invent a folder name.",
      prompt: `Item title: ${input.title}\nExcerpt: ${input.excerpt ?? "(none)"}\n\nCandidate folders:\n${folders
        .map((f) => `- ${f.title}`)
        .join("\n")}\n\nReturn the matching folder's title verbatim, or null if none fits well. Give a short reason under 6 words (e.g. "mentioned in 3 notes").`,
      schema: SuggestionSchema,
      effort: "low",
    });
    const picked =
      result?.folderTitle &&
      folders.find(
        (f) => f.title.toLowerCase() === result.folderTitle!.toLowerCase(),
      );
    if (picked) {
      return {
        bubbleId: picked.id,
        label: `File to ${picked.title}`,
        reason: result?.reason?.trim() || "suggested destination",
      };
    }
    // AI declined or failed to match — fall through to the heuristic rather
    // than leaving the item without any suggestion.
  }

  return heuristicMatch(folders, input);
}

/** Substring match against folder titles — cheap stand-in for the AI call. */
function heuristicMatch(
  folders: { id: string; title: string }[],
  input: { title: string; excerpt: string | null },
): SuggestedDestination | null {
  const haystack = `${input.title} ${input.excerpt ?? ""}`.toLowerCase();
  for (const folder of folders) {
    const needle = folder.title.toLowerCase().trim();
    if (needle.length > 2 && haystack.includes(needle)) {
      return {
        bubbleId: folder.id,
        label: `File to ${folder.title}`,
        reason: "mentioned in this item",
      };
    }
  }
  return null;
}
