/**
 * Server-only recruiter discovery helpers.
 *
 * Rules enforced here:
 * - We NEVER invent or pattern-guess an email address.
 * - Every email we surface must come with the public URL it was found on.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const JOB_BOARDS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "jobvite.com",
  "workable.com",
  "bamboohr.com",
  "ziprecruiter.com",
  "monster.com",
  "wellfound.com",
  "angel.co",
  "dice.com",
  "google.com",
  "recruitee.com",
  "teamtailor.com",
  "breezy.hr",
  "personio.de",
  "icims.com",
  "taleo.net",
];

const RECRUIT_TITLES = [
  "recruiter",
  "technical recruiter",
  "talent acquisition",
  "talent partner",
  "people operations",
  "head of talent",
  "hiring manager",
  "human resources",
  "hr manager",
  "talent sourcer",
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

const EMAIL_NOISE = [
  "example.com",
  "domain.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
  "yourcompany",
  "@2x",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  "@sentry",
  "u003e",
];

export interface FoundEmail {
  email: string;
  sourceUrl: string;
  context: string;
  recruitingRelevant: boolean;
}

export interface FoundProfile {
  name: string;
  title: string;
  linkedinUrl: string;
  sourceUrl: string;
}

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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function isJobBoard(host: string): boolean {
  return JOB_BOARDS.some((b) => host === b || host.endsWith(`.${b}`));
}

export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
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
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,24}$/.test(clean)) return null;
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

function classifyEmail(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return [
    "career",
    "job",
    "recruit",
    "talent",
    "hr",
    "people",
    "hiring",
    "apply",
    "work",
    "join",
  ].some((k) => local.includes(k));
}

function extractEmails(html: string, sourceUrl: string, domain?: string): FoundEmail[] {
  const text = stripHtml(html);
  const raw = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) raw.add(decodeURIComponent(m[1]!));
  for (const m of text.matchAll(EMAIL_RE)) raw.add(m[0]!);

  const out: FoundEmail[] = [];
  for (const candidate of raw) {
    const email = candidate
      .trim()
      .toLowerCase()
      .replace(/^[.,;:]+|[.,;:]+$/g, "");
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email)) continue;
    if (EMAIL_NOISE.some((n) => email.includes(n))) continue;
    if (domain && !email.endsWith(`@${domain}`) && !email.endsWith(`.${domain}`)) {
      // keep off-domain emails only when clearly recruiting related
      if (!classifyEmail(email)) continue;
    }
    const idx = text.toLowerCase().indexOf(email);
    const context = idx >= 0 ? text.slice(Math.max(0, idx - 140), idx + 140) : "";
    out.push({ email, sourceUrl, context, recruitingRelevant: classifyEmail(email) });
  }
  return out;
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

/** Public web search across a few engines, with fallbacks when one throttles us. */
export async function webSearch(
  query: string,
): Promise<{ title: string; url: string; snippet: string }[]> {
  const viaApi = await serperSearch(query);
  if (viaApi && viaApi.length) return viaApi.slice(0, 20);

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
    if (results.length) return results.slice(0, 20);
  }
  return [];
}

/** Find public LinkedIn profiles of recruiters / hiring people at a company. */
export async function findLinkedInProfiles(
  company: string,
  roleTitle: string,
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
    const results = await webSearch(query);
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.url)) continue;
      const url = r.url.split("?")[0]!;
      if (seen.has(url)) continue;
      // LinkedIn titles look like: "Jane Doe - Technical Recruiter - Acme | LinkedIn"
      const cleaned = r.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
      const parts = cleaned.split(/\s+[-\u2013\u2014]\s+/);
      const name = parts[0]?.trim() ?? cleaned;
      const title = parts.slice(1).join(" \u2013 ").trim();
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
): Promise<FoundEmail | null> {
  // Unquoted for the same free-tier reason as findLinkedInProfiles. Precision
  // is recovered by matchesPerson, which checks the address against both the
  // person's name and the company domain before it is ever surfaced.
  const query = domain ? `${name} email ${domain}` : `${name} ${company} email`;
  const results = (await webSearch(query)).slice(0, 4);

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

function matchesPerson(email: string, name: string, domain: string | null): boolean {
  const local = email.split("@")[0]!.toLowerCase();
  const host = email.split("@")[1]!.toLowerCase();
  if (domain && host !== domain && !host.endsWith(`.${domain}`)) return false;
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return false;
  return tokens.some((t) => local.includes(t));
}

export function linkedInPeopleSearchUrl(company: string, keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    `${company} ${keywords}`,
  )}&origin=GLOBAL_SEARCH_HEADER`;
}

export const RECRUITER_TITLE_KEYWORDS = RECRUIT_TITLES;
