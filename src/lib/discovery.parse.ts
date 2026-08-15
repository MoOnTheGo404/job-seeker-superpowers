/**
 * Pure parsing helpers for recruiter discovery.
 *
 * Split out of discovery.server.ts deliberately: this module touches no
 * network, no environment and no clock, so every function here is directly
 * unit-testable. These are also the functions most likely to break quietly —
 * a regex that stops matching produces zero contacts, not an error — which is
 * exactly why they live behind tests.
 *
 * Rule enforced here: an email is only ever *found*, never constructed.
 */

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

export const JOB_BOARDS = [
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

export const RECRUIT_TITLES = [
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

/** Substrings that mean a match is an asset filename, tracking pixel or sample. */
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

const RECRUITING_LOCAL_PARTS = [
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
];

export function stripHtml(html: string): string {
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
 * Reduce anything domain-shaped to a bare canonical host, or null if it isn't
 * one. Split from verifyDomain so the string handling can be tested without a
 * network round-trip.
 */
export function normalizeDomain(domain: string): string | null {
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z]{2,24}$/.test(clean) ? clean : null;
}

/** True when the local part looks like a recruiting inbox rather than a person. */
export function classifyEmail(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return RECRUITING_LOCAL_PARTS.some((k) => local.includes(k));
}

export function extractEmails(html: string, sourceUrl: string, domain?: string): FoundEmail[] {
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
      // Off-domain addresses only survive when they're clearly recruiting-related.
      if (!classifyEmail(email)) continue;
    }
    const idx = text.toLowerCase().indexOf(email);
    const context = idx >= 0 ? text.slice(Math.max(0, idx - 140), idx + 140) : "";
    out.push({ email, sourceUrl, context, recruitingRelevant: classifyEmail(email) });
  }
  return out;
}

/**
 * Does this address plausibly belong to this person at this company?
 *
 * The last gate before an email is shown to a user, so it errs strict: the host
 * must match the company domain, and some name token must appear in the local
 * part. A false positive here means attributing a stranger's address to someone.
 */
export function matchesPerson(email: string, name: string, domain: string | null): boolean {
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

/**
 * Split a LinkedIn search-result title into a person and their headline.
 *
 * Real titles look like "Jane Doe - Technical Recruiter - Acme | LinkedIn".
 * The trailing "| LinkedIn" is chrome; the first dash-separated segment is the
 * name and everything after it is the headline. Titles without a dash fall back
 * to treating the whole string as the name rather than inventing a split.
 */
export function parseLinkedInTitle(rawTitle: string): { name: string; title: string } {
  const cleaned = rawTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  return {
    name: (parts[0] ?? cleaned).trim(),
    title: parts.slice(1).join(" – ").trim(),
  };
}

/**
 * Recover a JSON value from model output that may be fenced or trailing-truncated.
 * Returns the fallback rather than throwing, so a bad generation degrades to a
 * default instead of failing the request.
 */
export function parseJsonBlock<T>(text: string, fallback: T): T {
  const cleaned = text
    .replace(/^```(?:json)?/gm, "")
    .replace(/```$/gm, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return fallback;
  const slice = cleaned.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    const lastBrace = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
    try {
      return JSON.parse(slice.slice(0, lastBrace + 1)) as T;
    } catch {
      return fallback;
    }
  }
}
