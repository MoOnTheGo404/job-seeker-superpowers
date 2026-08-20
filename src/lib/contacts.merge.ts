/**
 * Deciding which discovered contacts to upsert and which stored rows may be
 * deleted.
 *
 * Pure — no network, no clock, no database. Exists because rediscovery used to
 * delete every contact for a target and re-insert them, and `outreach` cascades
 * from `contacts`: clicking "Find recruiters" a second time silently destroyed
 * every draft and sent message for that company. Measured on real data, a
 * single rediscovery would have taken 100% of the outreach table with it.
 *
 * The fix needs a stable identity for a discovered person. Measured across 31
 * stored contacts: `linkedin_url` present on 30, `email` on 0, `name` tracking
 * `linkedin_url` exactly, and zero collisions within a target. So the LinkedIn
 * profile is the key, and the one row without it is a regenerated placeholder
 * that never holds a message.
 */

/** Canonical form of a LinkedIn profile URL, or null if it isn't one. */
export function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  /*
   * Host: drop `www.` and any country subdomain. LinkedIn serves one profile at
   * www., at in., uk. and the rest, so treating those as different people would
   * duplicate a contact the moment a search result came back localised — and
   * duplicate rows are how outreach gets orphaned.
   *
   * Safe for the country hint, which reads the in-memory profile URL during
   * discovery and never a stored row.
   */
  const host = url.hostname.toLowerCase().replace(/^(?:www|[a-z]{2})\./, "");
  if (!/^linkedin\.com$/.test(host)) return null;

  // Path identifies the person. Lowercased, no trailing slash, query and hash
  // discarded — none of them change who it points at.
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (!path || path === "/") return null;

  return `https://${host}${path}`;
}

/** The uniqueness key a contact row is upserted on. */
export function contactKey(
  targetId: string,
  contactType: string,
  linkedinUrl: string | null | undefined,
): string | null {
  const normalized = normalizeLinkedInUrl(linkedinUrl);
  if (!targetId || !contactType || !normalized) return null;
  return `${targetId}|${contactType}|${normalized}`;
}

export interface StoredContact {
  id: string;
  linkedin_url: string | null;
}

export interface UpsertPlan<T> {
  /** Discovered people with a usable key — safe to upsert. */
  upsertable: T[];
  /** Discovered rows with no key: placeholders, inserted fresh each run. */
  unkeyed: T[];
  /**
   * Stored rows that may be deleted: only those without a usable key.
   *
   * A row with a key is never deleted, even if this run did not surface the
   * person again. Someone dropping out of search results is not evidence they
   * left the company, and deleting them would take any message sent to them
   * along with it.
   */
  deletableExistingIds: string[];
}

/**
 * Split a discovery result and the rows already stored into an upsert plan.
 *
 * Discovered people are deduplicated by key, so two differently formatted URLs
 * for one person collapse into a single upsert rather than colliding.
 */
export function partitionForUpsert<T extends { linkedin_url: string | null }>(
  discovered: readonly T[],
  existing: readonly StoredContact[],
): UpsertPlan<T> {
  const upsertable: T[] = [];
  const unkeyed: T[] = [];
  const seen = new Set<string>();

  for (const row of discovered) {
    const key = normalizeLinkedInUrl(row.linkedin_url);
    if (!key) {
      unkeyed.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    upsertable.push(row);
  }

  const deletableExistingIds = existing
    .filter((row) => normalizeLinkedInUrl(row.linkedin_url) === null)
    .map((row) => row.id);

  return { upsertable, unkeyed, deletableExistingIds };
}
