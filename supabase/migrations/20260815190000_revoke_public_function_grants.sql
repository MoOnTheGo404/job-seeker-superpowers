-- Close a hole in the previous migration.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so
-- `GRANT EXECUTE ... TO authenticated` added nothing and anon kept the
-- inherited grant. Probing with only the publishable key confirmed it:
-- get_search_cache returned 200 and put_search_cache returned 204 — an
-- unauthenticated caller could read the cache and write arbitrary entries
-- into it, which is exactly what routing all access through definer
-- functions was supposed to prevent.
--
-- consume_rate_limit was not exploitable, but only because it checks
-- auth.uid() itself. Revoking PUBLIC is the actual control; that check is
-- defence in depth.
--
-- The lesson generalises: for SECURITY DEFINER functions, REVOKE FROM PUBLIC
-- is required. Granting to a role does not take anything away.

REVOKE ALL ON FUNCTION public.get_search_cache(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.put_search_cache(text, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, int, int) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_search_cache(text) FROM anon;
REVOKE ALL ON FUNCTION public.put_search_cache(text, jsonb, int) FROM anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, int, int) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_search_cache(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.put_search_cache(text, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) TO authenticated;

-- Drop anything an anonymous caller may already have written.
DELETE FROM public.search_cache WHERE cache_key = 'search:probe' OR cache_key = 'probe';
