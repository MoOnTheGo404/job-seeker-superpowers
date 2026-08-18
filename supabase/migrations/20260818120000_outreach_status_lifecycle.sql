-- Outreach lifecycle: drafted -> sent -> replied / no_reply -> closed.
--
-- The status column has existed since the first migration and has never been
-- written to. This gives it the vocabulary, the timestamp the follow-up list
-- depends on, and a link from a follow-up back to the message it chases.

-- When a message was actually sent. Null means never sent, which is what the
-- follow-up query keys on — no sentinel date, no zero timestamp.
ALTER TABLE public.outreach
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- A follow-up points at the message it follows up on. Nullable: most outreach
-- is an opening message and has no parent. ON DELETE SET NULL rather than
-- CASCADE, because deleting an original should orphan its follow-up, not
-- destroy a message the user actually sent.
ALTER TABLE public.outreach
  ADD COLUMN IF NOT EXISTS parent_outreach_id uuid
  REFERENCES public.outreach(id) ON DELETE SET NULL;

-- Existing rows carry 'draft', the original column default. The application
-- vocabulary is 'drafted'; rewrite before any constraint can reject them.
UPDATE public.outreach
  SET status = 'drafted'
  WHERE status = 'draft';

-- Anything sitting in a status this migration does not recognise would fail
-- the CHECK below with an opaque constraint error. Fail here instead, naming
-- the value, so the fix is obvious.
DO $$
DECLARE
  stragglers int;
  offending text;
BEGIN
  SELECT count(*) INTO stragglers
    FROM public.outreach
    WHERE status = 'draft';

  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % row(s) still carry status ''draft'' after the rewrite.',
      stragglers;
  END IF;

  SELECT string_agg(DISTINCT status, ', ') INTO offending
    FROM public.outreach
    WHERE status NOT IN ('drafted', 'sent', 'replied', 'no_reply', 'closed');

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration aborted: unexpected outreach status value(s): %', offending;
  END IF;
END $$;

ALTER TABLE public.outreach
  ALTER COLUMN status SET DEFAULT 'drafted';

-- Guarded the same way as outreach_purpose_check, so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_status_check'
  ) THEN
    ALTER TABLE public.outreach
      ADD CONSTRAINT outreach_status_check
      CHECK (status IN ('drafted', 'sent', 'replied', 'no_reply', 'closed'));
  END IF;
END $$;

-- Serves exactly one query: this user's sent messages, oldest first, to decide
-- which have gone quiet. Partial, because the other four statuses are never
-- scanned this way and do not belong in the index.
CREATE INDEX IF NOT EXISTS idx_outreach_followup
  ON public.outreach (user_id, sent_at)
  WHERE status = 'sent';

-- Report the state this migration leaves behind. Expect legacy_draft_rows = 0.
SELECT
  count(*) FILTER (WHERE status = 'draft')    AS legacy_draft_rows,
  count(*) FILTER (WHERE status = 'drafted')  AS drafted,
  count(*) FILTER (WHERE status = 'sent')     AS sent,
  count(*) FILTER (WHERE status = 'replied')  AS replied,
  count(*) FILTER (WHERE status = 'no_reply') AS no_reply,
  count(*) FILTER (WHERE status = 'closed')   AS closed,
  count(*)                                     AS total_rows
FROM public.outreach;
