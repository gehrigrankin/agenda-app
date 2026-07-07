import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

/**
 * AI service boundary (see ROADMAP.md "AI"): every Claude call in the app goes
 * through this module so the features stay optional. Mirrors the DB's
 * `isDbConfigured` pattern — with no ANTHROPIC_API_KEY the app still loads and
 * every AI entry point degrades to a "not configured" result instead of
 * throwing at import time.
 */
export const isAiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Cost posture: default to Haiku (cheapest tier, ~$1/$5 per MTok) — these are
 * extraction/summarization tasks it handles fine. Set AI_MODEL to a bigger
 * model (e.g. claude-opus-4-8) if answer quality ever warrants the ~5x spend.
 */
export const AI_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";

/**
 * Adaptive thinking + the effort parameter exist on Opus 4.6+/Sonnet 4.6+
 * only — sending either to Haiku is a 400. Requests adapt to the model.
 */
const SUPPORTS_ADAPTIVE_THINKING = /opus-4-[678]|opus-4\b|sonnet-5|sonnet-4-6|fable/.test(
  AI_MODEL,
);

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

export interface StructuredRequest<T> {
  system?: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  /** Cost/latency knob; product features default to "medium". */
  effort?: "low" | "medium" | "high";
}

/**
 * One structured-output call: the response is constrained to `schema` and
 * validated by the SDK. Returns null when AI is unconfigured or the call
 * fails — callers treat null as "feature unavailable right now" and must not
 * surface it as an error page.
 */
export async function aiStructured<T>(
  req: StructuredRequest<T>,
): Promise<T | null> {
  if (!isAiConfigured) return null;
  try {
    const response = await client().messages.parse({
      model: AI_MODEL,
      max_tokens: req.maxTokens ?? 4096,
      ...(SUPPORTS_ADAPTIVE_THINKING
        ? {
            thinking: { type: "adaptive" as const },
            output_config: {
              effort: req.effort ?? "medium",
              format: zodOutputFormat(req.schema),
            },
          }
        : {
            output_config: { format: zodOutputFormat(req.schema) },
          }),
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output ?? null;
  } catch (err) {
    console.error("[ai] structured request failed:", err);
    return null;
  }
}
