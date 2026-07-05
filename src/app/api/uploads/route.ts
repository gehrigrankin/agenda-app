import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attachments } from "@/db/schema";
import { storage } from "@/lib/storage";

/**
 * Image upload endpoint for the editor (POST multipart/form-data, "file"
 * field). Stores the bytes via the active storage adapter and records an
 * `attachments` row.
 *
 * NOTE: the default local driver writes under public/uploads, which is
 * EPHEMERAL on serverless hosts (Vercel etc.) — files vanish on redeploy.
 * The S3 adapter (see ROADMAP.md "Storage") is the production path; it drops
 * into src/lib/storage/index.ts without touching this route.
 */

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected a 'file' form field." },
      { status: 400 },
    );
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are supported." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Image is too large (max 5 MB)." },
      { status: 413 },
    );
  }

  const fileName = file.name || "image";

  try {
    const body = Buffer.from(await file.arrayBuffer());
    const stored = await storage.put({
      ownerId: userId,
      fileName,
      contentType: file.type,
      body,
    });

    // noteId stays null for MVP: the image node lives in note content, and
    // linking attachments to their hosting note precisely (incl. moves and
    // deletions) is a post-MVP reconciliation, like note_links but for files.
    await db.insert(attachments).values({
      ownerId: userId,
      kind: "image",
      storageKey: stored.key,
      url: stored.url,
      mimeType: file.type,
      fileName,
      sizeBytes: file.size,
    });

    return NextResponse.json({ url: stored.url, altText: fileName });
  } catch (err) {
    console.error("[uploads] failed:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
