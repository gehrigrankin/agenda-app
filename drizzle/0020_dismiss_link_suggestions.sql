-- Custom migration: retire the link_notes Gardener kind (product coherence:
-- recall + threads cover relatedness now, and recall skips already-linked
-- notes). Leftover open link_notes suggestions are resolved as dismissed so
-- they neither render (the client no longer has a card for them) nor
-- reappear (the dedupe row survives with its non-open status).
UPDATE gardener_suggestions
SET status = 'dismissed', resolved_at = now()
WHERE kind IN ('link_notes') AND status = 'open';
