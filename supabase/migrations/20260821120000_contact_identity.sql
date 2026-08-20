-- Give discovered contacts a stable identity, so rediscovery can upsert
-- instead of deleting and re-inserting them.
--
-- Why this matters: outreach.contact_id references contacts(id) ON DELETE
-- CASCADE, and discoverContacts deletes every contact for a target before
-- re-inserting. Clicking "Find recruiters" a second time therefore destroys
-- every draft and sent message for that company, silently. Measured on live
-- data before writing this: one rediscovery would have taken 100% of the
-- outreach table.
--
-- ORDERING IS DELIBERATE AND LOAD-BEARING.
--
--   1. backfill first  — 28 of 30 stored rows are https://www.linkedin.com/...
--                        and canonicalisation strips the www. If the index went
--                        first it would be built over unnormalised values, and
--                        two rows that only collide *after* canonicalisation
--                        would slip past it and then fail the upsert at runtime.
--   2. assert second   — collisions are checked on the canonical values, which
--                        only exist once step 1 has run.
--   3. index last      — created over data already known to satisfy it, so its
--                        creation cannot fail on rows this migration could have
--                        fixed.
--
-- Every step is idempotent; re-running is safe.

-- Counts are reported two ways, and neither creates an object: RAISE NOTICE
-- for what happened during the run, and a plain SELECT at the end for the
-- end state, which is independently checkable against the table itself.

DO $$
DECLARE
  total_with_url   bigint;
  already_canonical bigint;
  backfilled       bigint;
  collisions       bigint;
  offending        text;
BEGIN
  ---------------------------------------------------------------- step 1
  -- Canonical form, matching normalizeLinkedInUrl in src/lib/contacts.merge.ts:
  -- drop query and fragment, lowercase, force https, strip a www. or country
  -- subdomain, strip trailing slashes. LinkedIn serves one profile under every
  -- locale host, so in./uk./www. are the same person.
  SELECT count(*) INTO total_with_url
    FROM public.contacts
    WHERE linkedin_url IS NOT NULL;

  SELECT count(*) INTO already_canonical
    FROM public.contacts
    WHERE linkedin_url IS NOT NULL
      AND linkedin_url = regexp_replace(
            regexp_replace(
              lower(split_part(split_part(linkedin_url, '?', 1), '#', 1)),
              '^https?://(?:www\.|[a-z]{2}\.)?linkedin\.com', 'https://linkedin.com'
            ),
            '/+$', ''
          );

  UPDATE public.contacts
     SET linkedin_url = regexp_replace(
           regexp_replace(
             lower(split_part(split_part(linkedin_url, '?', 1), '#', 1)),
             '^https?://(?:www\.|[a-z]{2}\.)?linkedin\.com', 'https://linkedin.com'
           ),
           '/+$', ''
         )
   WHERE linkedin_url IS NOT NULL
     -- Only touch things that really are LinkedIn profile URLs. Anything else
     -- keeps whatever it had and simply never earns a key.
     AND linkedin_url ~* '^https?://(?:www\.|[a-z]{2}\.)?linkedin\.com/'
     AND linkedin_url <> regexp_replace(
           regexp_replace(
             lower(split_part(split_part(linkedin_url, '?', 1), '#', 1)),
             '^https?://(?:www\.|[a-z]{2}\.)?linkedin\.com', 'https://linkedin.com'
           ),
           '/+$', ''
         );
  GET DIAGNOSTICS backfilled = ROW_COUNT;

  ---------------------------------------------------------------- step 2
  -- Two contacts of the same type on the same target now pointing at one
  -- profile. Impossible to resolve automatically: either could be the row
  -- holding the outreach. Fail loudly and name them rather than let the index
  -- creation below produce an opaque duplicate-key error.
  SELECT count(*) INTO collisions FROM (
    SELECT 1
      FROM public.contacts
     WHERE linkedin_url IS NOT NULL
     GROUP BY target_id, contact_type, linkedin_url
    HAVING count(*) > 1
  ) dupes;

  IF collisions > 0 THEN
    SELECT string_agg(
             format('target=%s type=%s url=%s (%s rows)', target_id, contact_type, linkedin_url, n),
             E'\n'
           )
      INTO offending
      FROM (
        SELECT target_id, contact_type, linkedin_url, count(*) AS n
          FROM public.contacts
         WHERE linkedin_url IS NOT NULL
         GROUP BY target_id, contact_type, linkedin_url
        HAVING count(*) > 1
      ) d;

    RAISE EXCEPTION
      'Migration aborted: % duplicate contact identit(ies) after canonicalisation. Nothing was changed.%s%s',
      collisions, E'\n', offending;
  END IF;

  RAISE NOTICE 'rows_with_linkedin_url    = %', total_with_url;
  RAISE NOTICE 'already_canonical_before = %', already_canonical;
  RAISE NOTICE 'backfilled_by_this_run   = %', backfilled;
  RAISE NOTICE 'collisions_after_backfill = %', collisions;
END $$;

---------------------------------------------------------------- step 3
-- Partial: the placeholder rows discovery inserts when it confirms nobody
-- ("Recruiting team", "No referrers found") carry no URL, are legitimately
-- non-unique, and are regenerated every run. They must not be constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_identity
  ON public.contacts (target_id, contact_type, linkedin_url)
  WHERE linkedin_url IS NOT NULL;

-- End state, recomputed from the table rather than remembered. Expect
-- canonical_now to equal rows_with_linkedin_url, and collisions_now to be 0.
-- The during-run counts (how many were already canonical, how many this run
-- changed) are in the NOTICE output above.
SELECT
  count(*) FILTER (WHERE linkedin_url IS NOT NULL) AS rows_with_linkedin_url,
  count(*) FILTER (
    WHERE linkedin_url IS NOT NULL
      AND linkedin_url = regexp_replace(
            regexp_replace(
              lower(split_part(split_part(linkedin_url, '?', 1), '#', 1)),
              '^https?://(?:www\.|[a-z]{2}\.)?linkedin\.com', 'https://linkedin.com'
            ),
            '/+$', ''
          )
  ) AS canonical_now,
  (
    SELECT count(*) FROM (
      SELECT 1 FROM public.contacts
       WHERE linkedin_url IS NOT NULL
       GROUP BY target_id, contact_type, linkedin_url
      HAVING count(*) > 1
    ) d
  ) AS collisions_now,
  count(*) FILTER (WHERE linkedin_url IS NULL) AS placeholders
FROM public.contacts;
