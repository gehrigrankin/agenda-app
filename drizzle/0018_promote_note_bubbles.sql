-- Product coherence backfill (CONTEXT.md 2026-08-02): notes + folders are the
-- source of truth; the bubble canvas is a view. Any bubble holding a live note
-- must be a folder, and so must all its ancestors, so no note is invisible to
-- the Notes list. Ancestor promotion stops short of the root bubble (top-level
-- folders hang off a non-folder root — see src/lib/folderTree.ts); a root that
-- directly holds notes is still promoted via the anchor term, since visibility
-- wins. UNION (not UNION ALL) dedupes rows, which also terminates the walk on
-- any corrupt parent_id cycle.
WITH RECURSIVE promote AS (
	SELECT b.id, b.parent_id
	FROM bubbles b
	WHERE EXISTS (
		SELECT 1 FROM notes n
		WHERE n.bubble_id = b.id AND n.deleted_at IS NULL
	)
	UNION
	SELECT p.id, p.parent_id
	FROM bubbles p
	JOIN promote c ON c.parent_id = p.id
	WHERE p.parent_id IS NOT NULL
)
UPDATE bubbles
SET is_folder = true, updated_at = now()
WHERE bubbles.id IN (SELECT id FROM promote)
	AND bubbles.is_folder = false;--> statement-breakpoint
-- The retired archive_board Gardener kind (un-foldering hid a board's notes
-- from every Notes surface) directly contradicts the new invariant: resolve
-- any still-open suggestions as dismissed so they can't be accepted.
UPDATE gardener_suggestions
SET status = 'dismissed', resolved_at = now()
WHERE kind = 'archive_board' AND status = 'open';
