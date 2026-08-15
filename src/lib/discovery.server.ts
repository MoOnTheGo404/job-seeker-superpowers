/**
 * Server-only recruiter discovery helpers.
 *
 * Rules enforced here:
 * - We NEVER invent or pattern-guess an email address.
 * - Every email we surface must come with the public URL it was found on.
 */

import {
  classifyEmail,
  extractEmails,
  isJobBoard,
  matchesPerson,
  normalizeDomain,
  parseLinkedInTitle,
  scoreReferralCandidate,
  stripHtml,
  RECRUIT_TITLES,
  type FoundEmail,
  type FoundProfile,
} from "./discovery.parse";

export { isJobBoard, hostFromUrl } from "./discovery.parse";
export type { FoundEmail, FoundProfile } from "./discovery.parse";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

async function fetchText(url: string, timeoutMs = 9000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirm a company website actually resolves, and return its canonical host.
 *
 * The model can hallucinate a plausible-looking domain, and an unverified one
 * sends crawlCompanyEmails down a dozen dead-end requests. A bot-blocked
 * homepage still answers with *some* HTTP status, so treat any response as
 * proof the host exists and only reject when the connection itself fails.
 */
export async function verifyDomain(domain: string): Promise<string | null> {
  const clean = normalizeDomain(domain);
  if (!clean) return null;
  return (await domainResponds(clean)) ? clean : null;
}

async function domainResponds(host: string, timeoutMs = 7000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HEAD keeps this cheap. A 403/404/405 still proves the host resolves —
    // only DNS failure, a refused connection, or a timeout throws.
    await fetch(`https://${host}`, {
      method: "HEAD",
      headers: { "user-agent": UA },
      signal: controller.signal,
      redirect: "follow",
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const CONTACT_PATHS = [
  "",
  "/contact",
  "/contact-us",
  "/contacts",
  "/about",
  "/about-us",
  "/company",
  "/careers",
  "/careers/contact",
  "/jobs",
  "/team",
  "/people",
  "/impressum",
  "/legal",
];

/** Crawl a company's own public pages for published email addresses. */
export async function crawlCompanyEmails(domain: string): Promise<FoundEmail[]> {
  const results = await Promise.all(
    CONTACT_PATHS.map(async (path) => {
      const url = `https://${domain}${path}`;
      const html = await fetchText(url, 8000);
      return html ? extractEmails(html, url, domain) : [];
    }),
  );
  const seen = new Map<string, FoundEmail>();
  for (const found of results.flat()) {
    const existing = seen.get(found.email);
    if (!existing || (found.recruitingRelevant && !existing.recruitingRelevant))
      seen.set(found.email, found);
  }
  return [...seen.values()]
    .sort((a, b) => Number(b.recruitingRelevant) - Number(a.recruitingRelevant))
    .slice(0, 12);
}

const SEARCH_ENGINES = [
  (q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  (q: string) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
  (q: string) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
  (q: string) => `https://search.marcia.cc/search?q=${encodeURIComponent(q)}`,
  (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss`,
];

const ENGINE_HOSTS = [
  "duckduckgo.com",
  "mojeek.com",
  "bing.com",
  "microsoft.com",
  "google.com",
  "marcia.cc",
];

function parseResults(html: string): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  const seen = new Set<string>();

  // RSS (bing format=rss)
  for (const item of html.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = item[1]!;
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const desc = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
    if (link && !seen.has(link)) {
      seen.add(link);
      out.push({ url: link, title: stripHtml(title), snippet: stripHtml(desc) });
    }
  }
  if (out.length) return out;

  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url = m[1]!;
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!url.startsWith("http")) continue;
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (ENGINE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    const title = stripHtml(m[2]!);
    if (!title || title.length < 4) continue;
    const clean = url.split("#")[0]!;
    if (seen.has(clean)) continue;
    seen.add(clean);
    const idx = html.indexOf(m[0]!);
    const snippet = stripHtml(html.slice(idx, idx + 900)).slice(0, 400);
    out.push({ title, url: clean, snippet });
  }
  return out;
}

/** True when a real search API is configured, so we can skip scraper throttling. */
export function hasSearchApi(): boolean {
  return Boolean(process.env["SERPER_API_KEY"]);
}

/** Optional: a real search API key gives far better person-level results. */
async function serperSearch(
  query: string,
): Promise<{ title: string; url: string; snippet: string }[] | null> {
  const key = process.env["SERPER_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 20 }),
    });
    if (!res.ok) {
      // Returning null drops back to scraped engines — a large quality cliff
      // that is otherwise invisible. The free tier rejects `site:` and quoted
      // phrases with a 400, so surface it rather than silently degrading.
      console.warn(
        `[discovery] Serper ${res.status} for "${query}" — falling back to scraped search. ${(
          await res.text()
        ).slice(0, 160)}`,
      );
      return null;
    }
    const json = (await res.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };
    return (json.organic ?? [])
      .filter((r) => r.link)
      .map((r) => ({ title: r.title ?? "", url: r.link!, snippet: r.snippet ?? "" }));
  } catch {
    return null;
  }
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Injectable cache for search results. Kept as an interface so this module
 * stays free of any Supabase dependency — see cache.server.ts for the
 * Postgres-backed implementation, and so tests can pass a fake.
 */
export interface SearchCache {
  get(query: string): Promise<SearchResult[] | null>;
  set(query: string, results: SearchResult[]): Promise<void>;
}

/**
 * Public web search across a few engines, with fallbacks when one throttles us.
 *
 * The cache wraps every backend, which is the whole point: search is the
 * scarcest resource here, and two users targeting the same company issue
 * identical queries.
 */
export async function webSearch(query: string, cache?: SearchCache): Promise<SearchResult[]> {
  const cached = await cache?.get(query);
  if (cached?.length) return cached;

  const viaApi = await serperSearch(query);
  if (viaApi && viaApi.length) {
    const results = viaApi.slice(0, 20);
    await cache?.set(query, results);
    return results;
  }

  for (const build of SEARCH_ENGINES) {
    const html = await fetchText(build(query), 9000);
    if (!html) continue;
    if (
      /unusual traffic|captcha|are you a robot|not a bot|verifying your browser/i.test(
        html.slice(0, 4000),
      )
    )
      continue;
    const results = parseResults(html);
    if (results.length) {
      const top = results.slice(0, 20);
      await cache?.set(query, top);
      return top;
    }
  }
  return [];
}

/** Find public LinkedIn profiles of recruiters / hiring people at a company. */
export async function findLinkedInProfiles(
  company: string,
  roleTitle: string,
  cache?: SearchCache,
): Promise<FoundProfile[]> {
  /*
   * Deliberately operator-free: no `site:` and no quoted phrases.
   *
   * Serper's free tier rejects both with `400 Query pattern not allowed for
   * free accounts`, and serperSearch treats any non-OK response as "no API",
   * so operators would silently drop discovery back to scraping. Naming
   * linkedin.com/in as a plain term works on every backend, and the
   * linkedin.com/in URL filter below does the narrowing that `site:` used to.
   */
  const queries = [
    `${company} recruiter linkedin.com/in`,
    `${company} talent acquisition linkedin.com/in`,
    `${company} hiring manager ${roleTitle} linkedin.com/in`,
  ];
  const seen = new Map<string, FoundProfile>();
  for (const [index, query] of queries.entries()) {
    if (seen.size >= 8) break;
    const results = await webSearch(query, cache);
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.url)) continue;
      const url = r.url.split("?")[0]!;
      if (seen.has(url)) continue;
      const { name, title } = parseLinkedInTitle(r.title);
      if (!name) continue;
      seen.set(url, { name, title, linkedinUrl: url, sourceUrl: r.url });
    }
    // Space out scraped-engine queries so they don't throttle us. A real search
    // API needs no such courtesy, and there is nothing to wait for after the
    // final query either way.
    if (!hasSearchApi() && index < queries.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return [...seen.values()].slice(0, 8);
}

/** Search the open web for a published email that belongs to a named person. */
export async function searchPersonEmail(
  name: string,
  company: string,
  domain: string | null,
  cache?: SearchCache,
): Promise<FoundEmail | null> {
  // Unquoted for the same free-tier reason as findLinkedInProfiles. Precision
  // is recovered by matchesPerson, which checks the address against both the
  // person's name and the company domain before it is ever surfaced.
  const query = domain ? `${name} email ${domain}` : `${name} ${company} email`;
  const results = (await webSearch(query, cache)).slice(0, 4);

  // Snippets are already in hand — scan them all before paying for any fetch.
  for (const r of results) {
    const hit = extractEmails(r.snippet, r.url, domain ?? undefined).find((e) =>
      matchesPerson(e.email, name, domain),
    );
    if (hit) return hit;
  }

  // Nothing in the snippets, so fetch the pages — in parallel, since a serial
  // chain here is what pushed discoverContacts past the request timeout.
  const pages = await Promise.all(
    results.map(async (r) => ({ url: r.url, html: await fetchText(r.url, 7000) })),
  );
  for (const page of pages) {
    if (!page.html) continue;
    const match = extractEmails(page.html, page.url, domain ?? undefined).find((e) =>
      matchesPerson(e.email, name, domain),
    );
    if (match) return match;
  }
  return null;
}

/**
 * Find senior people in the job's own department who could refer the applicant.
 *
 * Distinct from findLinkedInProfiles in who it wants: that one looks for people
 * whose job is to receive applications, this one looks for people on the team
 * who could vouch. Recruiters are filtered out by scoreReferralCandidate, so
 * the two lists never overlap.
 *
 * Results are ranked rather than taken in search order — a Director on the
 * actual team beats a more senior stranger from another org.
 */
export async function findReferralProfiles(
  company: string,
  department: string | null,
  roleTitle: string,
  cache?: SearchCache,
): Promise<FoundProfile[]> {
  const focus = department ?? roleTitle;
  // Operator-free for the same free-tier reason as findLinkedInProfiles.
  const queries = [
    `${company} senior ${focus} linkedin.com/in`,
    `${company} ${focus} lead manager linkedin.com/in`,
    `${company} head of ${focus} director linkedin.com/in`,
  ];

  const seen = new Map<string, FoundProfile & { score: number }>();
  for (const [index, query] of queries.entries()) {
    const results = await webSearch(query, cache);
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.url)) continue;
      const url = r.url.split("?")[0]!;
      if (seen.has(url)) continue;
      const { name, title } = parseLinkedInTitle(r.title);
      if (!name) continue;
      const score = scoreReferralCandidate(title, department);
      // 0 means junior, a recruiter, or the wrong function — not a referrer.
      if (score === 0) continue;
      seen.set(url, { name, title, linkedinUrl: url, sourceUrl: r.url, score });
    }
    if (!hasSearchApi() && index < queries.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...profile }) => profile);
}

export function linkedInPeopleSearchUrl(company: string, keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    `${company} ${keywords}`,
  )}&origin=GLOBAL_SEARCH_HEADER`;
}

export const RECRUITER_TITLE_KEYWORDS = RECRUIT_TITLES;
