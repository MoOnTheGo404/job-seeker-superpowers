-- Structured applicant profile: move "About you" off localStorage and give it
-- parts rather than a paragraph.
--
-- Free text in the browser meant drafts came back with bracketed blanks and the
-- data did not survive a browser change. Structure is also the prerequisite for
-- matching a profile against a posting, which needs to compare parts — a
-- paragraph can only be searched, a list of entries can be scored.
--
-- schools and skills are real text[] rather than living inside the jsonb, so
-- matching can use array operators against them. experience is genuinely
-- nested and stays jsonb.
--
-- This is personal data. profiles already carries RLS scoped to auth.uid()
-- (policy "own profile", FOR ALL, added in the first migration) and that policy
-- covers new columns automatically — but the assertions below verify it rather
-- than assume it, because a table of someone's employment history with RLS
-- silently off is the worst failure available here.
--
-- Every step is idempotent; re-running is safe.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS schools    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS education  text   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS skills     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS experience jsonb  NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes      text   NOT NULL DEFAULT '';

DO $$
DECLARE
  missing_cols   text;
  wrong_types    text;
  users_total    bigint;
  profiles_total bigint;
  orphans        bigint;
  backfilled     bigint;
  rls_on         boolean;
  policy_count   bigint;
BEGIN
  ---------------------------------------------------------------- shape
  -- Every column present, or name the ones that are not. A partial ALTER would
  -- otherwise surface later as a runtime insert failure against live data.
  SELECT string_agg(c, ', ') INTO missing_cols
    FROM unnest(ARRAY['schools','education','skills','experience','notes']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = c
   );
  IF missing_cols IS NOT NULL THEN
    RAISE EXCEPTION 'Migration aborted: profile columns missing after ALTER: %', missing_cols;
  END IF;

  -- Types matter as much as presence: skills stored as text rather than text[]
  -- would accept writes and break every array query in session 2.
  SELECT string_agg(format('%s is %s, expected %s', column_name, data_type, expected), '; ')
    INTO wrong_types
    FROM (
      SELECT c.column_name, c.data_type, e.expected
        FROM information_schema.columns c
        JOIN (VALUES
               ('schools','ARRAY'), ('skills','ARRAY'),
               ('education','text'), ('notes','text'), ('experience','jsonb')
             ) AS e(name, expected) ON e.name = c.column_name
       WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
         AND c.data_type <> e.expected
    ) bad;
  IF wrong_types IS NOT NULL THEN
    RAISE EXCEPTION 'Migration aborted: unexpected column types: %', wrong_types;
  END IF;

  ---------------------------------------------------------------- coverage
  -- A user with no profiles row cannot save anything. handle_new_user covers
  -- accounts created after it existed; this covers any that predate it.
  SELECT count(*) INTO users_total FROM auth.users;

  INSERT INTO public.profiles (id, email)
  SELECT u.id, u.email
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);
  GET DIAGNOSTICS backfilled = ROW_COUNT;

  SELECT count(*) INTO profiles_total FROM public.profiles;
  SELECT count(*) INTO orphans
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % user(s) still have no profiles row; saving would fail for them.',
      orphans;
  END IF;

  ---------------------------------------------------------------- protection
  -- Personal data. Verify rather than trust.
  SELECT relrowsecurity INTO rls_on
    FROM pg_class WHERE oid = 'public.profiles'::regclass;
  IF NOT rls_on THEN
    RAISE EXCEPTION
      'Migration aborted: row level security is OFF on public.profiles. Refusing to store personal data unprotected.';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  IF policy_count = 0 THEN
    RAISE EXCEPTION
      'Migration aborted: RLS is enabled on public.profiles but no policy exists, so nobody can read their own profile.';
  END IF;

  RAISE NOTICE 'auth_users            = %', users_total;
  RAISE NOTICE 'profiles_total        = %', profiles_total;
  RAISE NOTICE 'profile_rows_backfilled = %', backfilled;
  RAISE NOTICE 'rls_enabled           = %', rls_on;
  RAISE NOTICE 'rls_policies          = %', policy_count;
END $$;

-- Read this back. Expect new_columns = 5, users_without_profile = 0,
-- rls_enabled = true, and rls_policies >= 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('schools','education','skills','experience','notes')
  ) AS new_columns,
  (SELECT count(*) FROM public.profiles) AS profiles_total,
  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
  ) AS users_without_profile,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass) AS rls_enabled,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles') AS rls_policies;
