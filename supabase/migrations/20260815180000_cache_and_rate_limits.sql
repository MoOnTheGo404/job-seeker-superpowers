-- Shared search cache + per-user rate limits.
--
-- Both exist for the same reason: every user's discovery runs on one shared
-- Serper key and one shared Gemini key. Without these, a single user clicking
-- "Find recruiters" repeatedly drains the month's quota for everybody.
--
-- Writes go through SECURITY DEFINER functions rather than direct table grants,
-- so a client holding the publishable key cannot poison the cache or forge its
-- own rate-limit counters. Each function pins search_path to resist search-path
-- hijacking, which SECURITY DEFINER otherwise exposes.

-- ---------------------------------------------------------------------------
-- Search cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.search_cache (
  cache_key text PRIMARY KEY,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON public.search_cache(expires_at);

ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies: the table is unreachable directly. All access is
-- via the definer functions below, which is what keeps writes trustworthy.
REVOKE ALL ON public.search_cache FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_search_cache(p_key text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT results
  FROM public.search_cache
  WHERE cache_key = p_key
    AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.put_search_cache(
  p_key text,
  p_results jsonb,
  p_ttl_seconds int DEFAULT 604800  -- 7 days
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Bounded so a caller cannot pin an entry indefinitely.
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 2592000 THEN
    p_ttl_seconds := 604800;
  END IF;

  INSERT INTO public.search_cache (cache_key, results, expires_at)
  VALUES (p_key, p_results, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (cache_key) DO UPDATE
    SET results = EXCLUDED.results,
        created_at = now(),
        expires_at = EXCLUDED.expires_at;

  -- Opportunistic sweep. Cheap, and saves running a scheduled job for a table
  -- this small.
  DELETE FROM public.search_cache WHERE expires_at < now() - interval '1 day';
END;
$$;

-- REVOKE first: Postgres grants EXECUTE to PUBLIC by default on a new
-- function, so granting to a role does not take that away. Without this,
-- anon can call these.
REVOKE ALL ON FUNCTION public.get_search_cache(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.put_search_cache(text, jsonb, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_search_cache(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.put_search_cache(text, jsonb, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Readable so the UI could show remaining quota; never writable directly,
-- otherwise a user could reset their own counter.
CREATE POLICY "own rate limits readable" ON public.rate_limits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT SELECT ON public.rate_limits TO authenticated;

/*
 * Consume one unit of a user's allowance, atomically.
 *
 * Fixed window rather than sliding: a sliding window needs per-request
 * timestamps, and the extra precision is not worth the write volume here.
 * The identity comes from auth.uid() inside the function, so a client cannot
 * spend someone else's allowance or claim a different one.
 */
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_window_start timestamptz;
  v_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Truncate now() down to the current window boundary.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (user_id, action, window_start, count)
  VALUES (v_user, p_action, v_window_start, 1)
  ON CONFLICT (user_id, action, window_start) DO UPDATE
    SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  DELETE FROM public.rate_limits
  WHERE user_id = v_user AND window_start < now() - interval '1 day';

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'used', v_count,
    'limit', p_limit,
    'resets_at', v_window_start + make_interval(secs => p_window_seconds)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) TO authenticated;
