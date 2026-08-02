import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { addSharedItem } from "@/server/inbox";

/**
 * PWA share-target endpoint (manifest.share_target → POST /app/share): the OS
 * share sheet submits multipart/form-data with title/text/url and optional
 * image files, we store a capture_inbox row, then 303-redirect into
 * /app/inbox so the share lands the user on the queue they just fed.
 *
 * A route handler, not a page: a share is a data submission with no UI of its
 * own — the redirect target (/app/inbox) is the UI. A page.tsx here would
 * only exist to run this same logic in a server component and immediately
 * redirect, and pages can't receive POST bodies anyway.
 *
 * Auth: middleware.ts already protects /app(.*) (Clerk redirects a signed-out
 * share to sign-in); the in-handler check is defense in depth for
 * middleware-matcher drift. CSRF exposure is accepted as negligible: the
 * endpoint only appends to the caller's own inbox, mirroring what any share
 * could do, and share-sheet POSTs are same-origin top-level navigations.
 */

export const dynamic = "force-dynamic";

// Same cap as /api/uploads (base64 in Postgres adds ~33%).
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url), 303);
  }

  // No DB → nothing to store; degrade to just landing on the inbox page
  // (which renders its empty state) instead of erroring the share sheet.
  if (!isDbConfigured) {
    return NextResponse.redirect(new URL("/app/inbox", req.url), 303);
  }

  const formData = await req.formData().catch(() => null);
  if (formData) {
    const title = str(formData.get("title"));
    const text = str(formData.get("text"));
    const url = str(formData.get("url"));

    // First usable shared image (share sheets may attach several).
    let image: {
      fileName: string;
      contentType: string;
      body: Buffer;
    } | null = null;
    for (const entry of formData.getAll("images")) {
      if (
        entry instanceof File &&
        entry.size > 0 &&
        entry.size <= MAX_UPLOAD_BYTES &&
        entry.type.startsWith("image/")
      ) {
        image = {
          fileName: entry.name || "image",
          contentType: entry.type,
          body: Buffer.from(await entry.arrayBuffer()),
        };
        break;
      }
    }

    if (title || text || url || image) {
      try {
        await addSharedItem(userId, { title, text, url, image });
      } catch (err) {
        // A failed store still redirects — erroring inside the OS share flow
        // strands the user on a broken interstitial with no UI.
        console.error("[share] failed to store shared item:", err);
      }
    }
  }

  return NextResponse.redirect(new URL("/app/inbox", req.url), 303);
}

/** Direct navigation to /app/share (no share payload) just opens the inbox. */
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/app/inbox", req.url), 303);
}

function str(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}
