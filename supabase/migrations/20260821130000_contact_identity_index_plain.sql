-- Replace the partial contact-identity index with a plain one.
--
-- The partial predicate (WHERE linkedin_url IS NOT NULL) was both unnecessary
-- and actively harmful.
--
-- Unnecessary: Postgres treats NULLs as distinct in a unique index, so the
-- placeholder rows discovery inserts when it confirms nobody — "Recruiting
-- team", "No referrers found", all with linkedin_url IS NULL — never collide
-- on a plain unique index either. They were already safe.
--
-- Harmful: ON CONFLICT can only infer a *partial* unique index when the
-- statement repeats the index predicate, as ON CONFLICT (a, b, c) WHERE c IS
-- NOT NULL. supabase-js has no way to emit that clause, so every upsert would
-- have failed at runtime with "no unique or exclusion constraint matching the
-- ON CONFLICT specification" — after the wiring was written and against live
-- data.
--
-- ORDERING IS DELIBERATE. The new index is built before the old one is
-- dropped, so there is never a moment without uniqueness protection. If the
-- new index cannot be built — a duplicate identity appeared since the
-- backfill — this fails with the old index still in place and nothing lost.
-- No table rows are read, written or removed by any statement here.

-- 1. Build the replacement alongside the existing one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_identity_plain
  ON public.contacts (target_id, contact_type, linkedin_url);

-- 2. Only now retire the partial one.
DROP INDEX IF EXISTS public.idx_contacts_identity;

-- 3. Take over the original name, so the schema reads as though it was always
--    this way and a re-run of the earlier migration's IF NOT EXISTS is a no-op.
ALTER INDEX IF EXISTS public.idx_contacts_identity_plain
  RENAME TO idx_contacts_identity;

-- Prove both properties that matter, from the data rather than from intent:
-- placeholders still coexist under a plain unique index, and no two contacts
-- share an identity. The CREATE above succeeding is itself the proof that NULL
-- distinctness holds here.
SELECT
  count(*) FILTER (WHERE linkedin_url IS NULL)     AS placeholders,
  count(*) FILTER (WHERE linkedin_url IS NOT NULL) AS keyed_contacts,
  (
    SELECT count(*) FROM (
      SELECT 1 FROM public.contacts
       WHERE linkedin_url IS NOT NULL
       GROUP BY target_id, contact_type, linkedin_url
      HAVING count(*) > 1
    ) d
  ) AS collisions_now
FROM public.contacts;
