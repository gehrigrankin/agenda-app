import { NextResponse } from "next/server";

import { db, isDbConfigured, schema } from "@/db";

/**
 * External task-capture endpoint — lets a trusted automation (chuck) create a
 * first-class task WITHOUT a Clerk browser session, authenticated by a shared
 * bearer token.
 *
 *   POST /api/tasks
 *   Authorization: Bearer $TASKS_API_TOKEN
 *   { "title": string, "dueAt"?: "YYYY-MM-DD" | ISO-8601, "description"?: string }
 *   -> 201 { ok: true, task }
 *
 * Owner resolution: TASKS_API_OWNER_ID if set, else the sole owner of this
 * single-user deployment (first user_settings row, then any task, then any
 * note). Identity here is the shared token — there is no per-user scoping
 * because this is a personal instance.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { tasks, notes, userSettings } = schema;

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

async function resolveOwnerId(): Promise<string | null> {
  const fromEnv = process.env.TASKS_API_OWNER_ID;
  if (fromEnv) return fromEnv;
  const s = await db
    .select({ ownerId: userSettings.ownerId })
    .from(userSettings)
    .limit(1);
  if (s[0]) return s[0].ownerId;
  const t = await db.select({ ownerId: tasks.ownerId }).from(tasks).limit(1);
  if (t[0]) return t[0].ownerId;
  const n = await db.select({ ownerId: notes.ownerId }).from(notes).limit(1);
  if (n[0]) return n[0].ownerId;
  return null;
}

export async function POST(req: Request) {
  const token = process.env.TASKS_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "TASKS_API_TOKEN not set" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const ownerId = await resolveOwnerId();
    if (!ownerId) {
      return NextResponse.json(
        { error: "No owner found; set TASKS_API_OWNER_ID" },
        { status: 500 },
      );
    }
    const [task] = await db
      .insert(tasks)
      .values({ ownerId, title: sanitizeTitle(body.title), dueAt, description })
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
