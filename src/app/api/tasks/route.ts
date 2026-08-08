import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/server/api-auth";

import { db, isDbConfigured, schema } from "@/db";

/**
 * External task-capture endpoint — lets a trusted automation (chuck) create a
 * first-class task WITHOUT a Clerk browser session, authenticated by a shared
 * bearer token.
 *
 *   POST /api/tasks
 *   Authorization: Bearer $NOTARIUM_API_TOKEN
 *   { "title": string, "dueAt"?: "YYYY-MM-DD" | ISO-8601, "description"?: string }
 *   -> 201 { ok: true, task }
 *
 * Auth and owner resolution are shared with the MCP server — see
 * `src/server/api-auth.ts`. Both env vars are required and it fails closed;
 * this route no longer guesses the owner from whatever row it finds first.
 *
 * Superseded by `POST /api/mcp` (`tasks_create`), which also handles tags and
 * every other surface. Kept because an existing integration points at it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { tasks } = schema;

const TITLE_MAX = 500;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeTitle(title: string): string {
  return title.trim().slice(0, TITLE_MAX) || "Untitled task";
}

// Returns a Date, null for "no due date", or undefined for "invalid input".
function parseDueAt(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const s = raw.trim();
  if (DATE_ONLY_RE.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)); // midnight UTC, matching setTaskDue
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

export async function POST(req: Request) {
  // Auth and owner resolution now live in one place, shared with the MCP
  // server. This route used to resolve the owner by falling back to the first
  // row in user_settings / tasks / notes when the env var was unset — see
  // `src/server/api-auth.ts` for why that's gone.
  const auth = authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isDbConfigured) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; dueAt?: unknown; description?: unknown }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const dueAt = parseDueAt(body.dueAt);
  if (dueAt === undefined) {
    return NextResponse.json(
      { error: "dueAt must be YYYY-MM-DD or an ISO-8601 date" },
      { status: 400 },
    );
  }
  const description =
    typeof body.description === "string" && body.description.trim() !== ""
      ? body.description.trim()
      : null;

  try {
    const [task] = await db
      .insert(tasks)
      .values({
        ownerId: auth.ownerId,
        title: sanitizeTitle(body.title),
        dueAt,
        description,
      })
      .returning();
    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (err) {
    console.error("[api/tasks] create failed:", err);
    const detail = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `Create failed — ${detail}` },
      { status: 500 },
    );
  }
}
