import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, isDbConfigured } from "@/db";
import { uploadBlobs } from "@/db/schema";

/**
 * Serves images stored by the db storage driver (see src/lib/storage/db.ts).
 * Owner-scoped: only the uploader's session can read the bytes. Content is
 * immutable per id, so it caches privately for a year.
 */

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ error: "No database" }, { status: 404 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [row] = await db
    .select({
      mimeType: uploadBlobs.mimeType,
      dataBase64: uploadBlobs.dataBase64,
    })
    .from(uploadBlobs)
    .where(and(eq(uploadBlobs.id, id), eq(uploadBlobs.ownerId, userId)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(Buffer.from(row.dataBase64, "base64"), {
    headers: {
      "Content-Type": row.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
