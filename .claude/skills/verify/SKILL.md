---
name: verify
description: Build, launch, and drive this app headlessly to verify changes at the real UI — Clerk ticket sign-in, Playwright recipes, and the flows worth driving.
---

# Verifying agenda-app changes

## Launch

- `npm run dev` (background, log to a file). **Check the log for the actual
  port** — if 3000 is taken it silently moves to 3001.
- DB: reads `DATABASE_URL` from `.env.local` (Neon). Migrations:
  `npm run db:migrate`.

## Headless browser

- No system Chromium: in a scratch dir, `npm i playwright-core &&
  npx playwright-core install chromium-headless-shell`.
- `getUserMedia` does NOT work in chromium-headless-shell even with
  `--use-fake-device-for-media-capture` — voice-capture recording can only be
  verified up to the "requesting microphone…" state headlessly.

## Auth (no password exists for the test account)

1. Mint a sign-in token (single-use, print the WHOLE token — don't truncate).
   The `Content-Type` header is required, or the body is form-encoded and Clerk
   reports `user_id` missing:
   `curl -X POST https://api.clerk.com/v1/sign_in_tokens -H "Authorization: Bearer $CLERK_SECRET_KEY" -H "Content-Type: application/json" -d '{"user_id":"user_3G6XlNsafcrl2kZCkdAV8OiyhZF"}'`
2. `page.goto("http://localhost:<port>/sign-in?__clerk_ticket=<token>")`, then
   `waitForURL("**/app**")`.

**That account (gehrigspam@gmail.com) is EMPTY on purpose.** Its fixtures were
wiped 2026-08-09 — the owner uses one account, rgrankin22@gmail.com
(`user_368szVRdV9GLCaCol5TQ8e8XIuy`), and a second populated workspace kept
raising "why are there two accounts?". The login is kept as a disposable
sandbox so browser runs never touch his real ~1000 rows.

- Need fixtures? `npx tsx scripts/seed-dummy.ts` — it defaults to this owner id
  and wipes-then-reseeds, so it is safe to re-run.
- **Never point a destructive or data-writing test at
  `user_368szVRdV9GLCaCol5TQ8e8XIuy`.** Read-only checks against his real data
  are fine when the change only shows up with real content; anything that
  creates, edits, or deletes belongs on the sandbox account.
- Verifying a change that needs specific rows? Insert them for the sandbox
  owner, then delete them at the end of the run.

## Gotchas

- `networkidle` never settles (Clerk keeps sockets open) — use
  `domcontentloaded` + element waits.
- Copy uses **curly apostrophes** (`isn’t`, `Today’s`) — straight-quote text
  locators silently match nothing.
- Dev-mode home fires ~6 parallel server-action POSTs; one occasionally drops
  (`Failed to fetch`, rotating victim widget). Known dev flakiness.
- First hit on a new route compiles for several seconds — screenshot skeletons
  are usually compile latency, not bugs; settle-wait ~5s before judging.

## Flows worth driving

- Daily note: type → "saved" indicator; timestamps in the gutter.
- ⌘K palette: title search; a `?`/4-word query adds the "Ask your notes" row
  (needs `ANTHROPIC_API_KEY`, else shows the not-set-up notice).
- Recall cards: type ≥20 chars in the daily editor, pause ~2s, cards appear to
  the right of the content column (viewport must be wide, ≥1400px).
- Threads (`/app/threads`), Automations (`/app/automations`): CRUD flows work
  without an API key; scans/runs need it.
- Sunday week-review card: `/app?d=<a-sunday>`; renders nothing without an API
  key and no cached review.
