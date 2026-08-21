import {
  looksFilled,
  looksLikeAuthWall,
  looksLikeJobSearchPage,
  looksLikeListingTitle,
  looksUnreadable,
  stripConfigBlobs,
} from "./discovery.parse";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export type PageFetch =
  | { ok: true; text: string }
  /** The URL resolved to a login screen — the posting itself is unreadable. */
  | { ok: false; reason: "auth_wall" }
  /** Fetched fine and contained no readable text, e.g. a client-rendered shell. */
  | { ok: false; reason: "unreadable" }
  /** The posting exists but has been filled or closed. */
  | { ok: false; reason: "filled" }
  /** The URL is a jobs search or listing page, not one posting. */
  | { ok: false; reason: "search_page" }
  /** Network error, timeout, non-HTML, or an error status. */
  | { ok: false; reason: "unavailable" };

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a public page and return readable text (server-only).
 *
 * Returns a result rather than `string | null` so the caller can tell "this
 * posting is behind a login" apart from "the fetch failed". They need
 * different responses: the first is a dead end no retry will fix, and the user
 * has to paste the description instead.
 */
export async function fetchPublicPage(url: string, timeoutMs = 10_000): Promise<PageFetch> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "unavailable" };
  }

  /*
   * Checked before fetching: a search URL cannot become a posting, and reading
   * one would hand the model a page of other companies' roles.
   */
  if (looksLikeJobSearchPage(parsed.toString())) {
    return { ok: false, reason: "search_page" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });

    // 401/403 is an auth wall stating itself plainly. The subtler case is a
    // 200 login page, caught by looksLikeAuthWall below.
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth_wall" };
    if (!res.ok) return { ok: false, reason: "unavailable" };

    const html = await res.text();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    /*
     * Config blobs come off before anything judges the text. A Phenom career
     * site inlines its whole theme configuration, and stripHtml removes tags
     * but not a JSON object sitting in a text node — one page arrived 40% CSS
     * variables by volume, which is nothing dressed as content.
     */
    const text = stripConfigBlobs(toText(html));

    // res.url is the URL after redirects, which is what reveals a portal that
    // quietly bounced /jobs/123 to /access.
    if (looksLikeAuthWall(res.url || parsed.toString(), title, text)) {
      return { ok: false, reason: "auth_wall" };
    }

    /*
     * A listing served from a posting URL. LinkedIn answers an unauthenticated
     * fetch of /jobs/view/<id> with a search page, so the URL check above
     * cannot see it — the URL is right and the response is wrong. The title is
     * where it shows: a posting is titled after one role, a listing after how
     * many it found.
     */
    if (looksLikeListingTitle(title)) return { ok: false, reason: "search_page" };

    /*
     * Checked after the auth wall, because a login screen is the more specific
     * diagnosis and both would otherwise match a near-empty page.
     */
    if (looksUnreadable(text)) return { ok: false, reason: "unreadable" };

    /*
     * Checked last: a filled posting is still a readable page, and this is the
     * one case where a definite negative beats a null. The ATS replaces the
     * description with its own furniture, so without this the model describes a
     * benefits blurb and reports it as the job.
     */
    if (looksFilled(text)) return { ok: false, reason: "filled" };

    return { ok: true, text: text.slice(0, 20_000) };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
