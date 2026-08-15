import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchCache, SearchResult } from "./discovery.server";

/**
 * Postgres-backed cache for web search results.
 *
 * Recruiters at a company do not change hour to hour, and several users
 * targeting the same employer issue identical queries — so this is shared
 * across all users rather than scoped per user. That sharing is the point:
 * the second person to search "Stripe recruiter" spends no quota at all.
 *
 * Reads and writes both go through SECURITY DEFINER functions; the table
 * itself is not directly reachable with the publishable key, so a client
 * cannot write arbitrary entries.
 */

/** Long enough to matter, short enough that people who changed jobs age out. */
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Normalise before hashing so trivial variations share an entry. Queries are
 * built from company and role names, which arrive with inconsistent casing and
 * spacing from the model.
 */
export function buildCacheKey(query: string): string {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  return `search:${normalized}`;
}

export function createSearchCache(
  supabase: SupabaseClient,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SearchCache {
  return {
    async get(query) {
      const { data, error } = await supabase.rpc("get_search_cache", {
        p_key: buildCacheKey(query),
      });
      // A cache failure must never fail the request — fall through to a live
      // search instead.
      if (error) {
        console.warn(`[cache] read failed: ${error.message}`);
        return null;
      }
      return (data as SearchResult[] | null) ?? null;
    },

    async set(query, results) {
      // Don't cache empty results: an empty list is usually a throttled or
      // failed search, and caching it would freeze that failure in for a week.
      if (!results.length) return;

      const { error } = await supabase.rpc("put_search_cache", {
        p_key: buildCacheKey(query),
        p_results: results,
        p_ttl_seconds: ttlSeconds,
      });
      if (error) console.warn(`[cache] write failed: ${error.message}`);
    },
  };
}
