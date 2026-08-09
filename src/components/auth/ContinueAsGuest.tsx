"use client";

import { useFormStatus } from "react-dom";

import { continueAsGuest } from "@/app/guest-actions";

/**
 * The escape hatch on the auth pages. Minting a workspace touches the DB and
 * then redirects, so the button owns a pending state — otherwise the page sits
 * there looking dead on a cold serverless start.
 */
export function ContinueAsGuest() {
  return (
    <form action={continueAsGuest} className="contents">
      <GuestButton />
    </form>
  );
}

function GuestButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-white/15 px-4 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:bg-white/8 disabled:opacity-60"
      >
        {pending ? "Setting things up…" : "Continue as guest"}
      </button>
      <p className="text-center text-xs text-ink-600">
        Your notes stay on this browser until you make an account.
      </p>
    </>
  );
}
