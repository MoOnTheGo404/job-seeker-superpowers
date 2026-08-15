-- Referral targets: senior people in the job's own department who could refer
-- the applicant, alongside the recruiters we already find.
--
-- Recruiters and referrers share the `contacts` table rather than getting their
-- own. They carry identical fields, identical RLS, and both hang off a target
-- and feed outreach — a second table would duplicate all of that to express one
-- enum's worth of difference.

-- What team is actually hiring. Filled by analyzeJob; used to aim the referral
-- search at the right function rather than the company at large.
ALTER TABLE public.job_targets
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS seniority text;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS contact_type text NOT NULL DEFAULT 'recruiter';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_contact_type_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_contact_type_check
      CHECK (contact_type IN ('recruiter', 'referrer'));
  END IF;
END $$;

-- An application note and a referral ask are different messages to different
-- people with different asks, so drafts are tagged and kept apart.
ALTER TABLE public.outreach
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'application';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_purpose_check'
  ) THEN
    ALTER TABLE public.outreach
      ADD CONSTRAINT outreach_purpose_check
      CHECK (purpose IN ('application', 'referral'));
  END IF;
END $$;

-- Discovery re-runs delete and re-insert only their own contact_type, so
-- re-running the recruiter search never clears found referrers (and vice
-- versa). This index serves that scoped delete as well as the split UI lists.
CREATE INDEX IF NOT EXISTS idx_contacts_target_type
  ON public.contacts(target_id, contact_type);
