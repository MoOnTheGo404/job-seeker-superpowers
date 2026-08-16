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
  // Handshake is the university careers portal. Its postings sit behind a
  // student login, so we can never read one — but it still has to be listed
  // here, because the company_domain fallback in analyzeJob would otherwise
  // decide the employer *is* Handshake and go hunting for its recruiters.
  "joinhandshake.com",
  "simplify.jobs",
  "builtin.com",
  "simplyhired.com",
  "careerbuilder.com",
  "talent.com",
];

/*
 * Paths a site redirects to when it wants you logged in. Matched against the
 * *final* URL after redirects, which is the strongest signal available: a real
 * posting stays on its own URL, an auth-walled one lands somewhere like
 * /access or /users/sign_in.
 */
const AUTH_PATH =
  /^\/(access|login|log-in|signin|sign-in|sign_in|auth|authenticate|sso|session|sessions\/new|users\/sign_in|account\/login|checkpoint)\b/i;

/*
 * Titles that announce a login screen. Deliberately matched against <title>
 * and not body text — plenty of genuine job pages have a "Sign in" link in the
 * nav, but almost none are *titled* one.
 */
const AUTH_TITLE =
  /\b(log ?in|sign ?in|sign ?up|authentication required|access denied|forbidden)\b/i;

/** Words that only show up on a real posting, used to veto a false positive. */
const JOB_SIGNAL =
  /\b(responsibilities|qualifications|requirements|what you'?ll do|about the role|apply now|job description|benefits|salary|compensation)\b/i;

/**
 * Decide whether a fetched page is a login wall rather than the job posting.
 *
 * This matters because an auth wall answers with HTTP 200 and valid HTML, so
 * every ordinary error check passes and the login screen gets handed to the
 * model as if it were the posting. The model then dutifully extracts the
 * *portal's* name as the employer. Silent, confident, and wrong — worse than
 * a plain failure, which is why it is detected explicitly.
 */
export function looksLikeAuthWall(finalUrl: string, title: string, text: string): boolean {
  // A page that actually describes a job is not a login wall, whatever its
  // title says. Checked first so it can override the weaker signals below.
  if (JOB_SIGNAL.test(text)) return false;

  try {
    if (AUTH_PATH.test(new URL(finalUrl).pathname)) return true;
  } catch {
    // Unparseable URL — fall through to the content checks.
  }

  if (AUTH_TITLE.test(title)) return true;

  // A very short page that talks about logging in and nothing else.
  return text.length < 600 && /\b(log ?in|sign ?in|create an account)\b/i.test(text);
}

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

/**
 * Titles senior enough that a referral from them carries weight. Ordered
 * loosely by rank; `scoreReferralCandidate` uses position, so keep the most
 * senior terms last.
 */
export const SENIORITY_TERMS = [
  "senior",
  "sr.",
  "lead",
  "staff",
  "manager",
  "principal",
  "architect",
  "head of",
  "director",
  "distinguished",
  "vp",
  "vice president",
  "chief",
];

/** Function keywords, so an engineering job doesn't surface the sales org. */
const DEPARTMENT_HINTS: Record<string, string[]> = {
  engineering: [
    "engineer",
    "engineering",
    "developer",
    "software",
    "backend",
    "frontend",
    "full stack",
    "infrastructure",
    "platform",
    "sre",
    "devops",
    "architect",
  ],
  data: ["data", "analytics", "scientist", "machine learning", "ml", "ai research"],
  product: ["product manager", "product management", "product owner", "pm"],
  design: ["design", "designer", "ux", "ui", "research"],
  marketing: ["marketing", "growth", "brand", "content", "demand gen"],
  sales: ["sales", "account executive", "business development", "revenue", "gtm"],
  finance: ["finance", "accounting", "controller", "fp&a"],
  operations: ["operations", "ops", "program manager", "project manager"],
  legal: ["legal", "counsel", "compliance"],
  support: ["support", "customer success", "solutions"],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Is this headline senior enough to be worth asking for a referral?
 *
 * Deliberately excludes recruiters: they're already covered by recruiter
 * discovery, and a referral ask is a different request to a different person.
 */
export function isSeniorTitle(title: string): boolean {
  const t = normalize(title);
  if (!t) return false;
  if (isRecruiterTitle(t)) return false;
  return SENIORITY_TERMS.some((term) => t.includes(term));
}

export function isRecruiterTitle(title: string): boolean {
  const t = normalize(title);
  return RECRUIT_TITLES.some((term) => t.includes(term)) || /\brecruit/.test(t);
}

/**
 * Does this headline sit in the same function as the job?
 *
 * Unknown or unmatched departments return true rather than false — a weak
 * signal should widen the pool, not empty it.
 */
export function matchesDepartment(title: string, department: string | null): boolean {
  if (!department) return true;
  const t = normalize(title);
  const d = normalize(department);
  const bucket = Object.entries(DEPARTMENT_HINTS).find(
    ([name, hints]) => d.includes(name) || hints.some((h) => d.includes(h)),
  );
  if (!bucket) return true;
  return bucket[1].some((h) => t.includes(h));
}

/**
 * Rank a referral candidate. Higher is better; 0 means "don't show".
 *
 * Seniority contributes by rank so a Director outranks a Senior, and a
 * department match roughly doubles the score — a senior person on the actual
 * team is worth more than a more senior stranger elsewhere in the company.
 */
export function scoreReferralCandidate(title: string, department: string | null): number {
  const t = normalize(title);
  if (!t || isRecruiterTitle(t)) return 0;

  const rank = SENIORITY_TERMS.reduce(
    (best, term, i) => (t.includes(term) ? Math.max(best, i + 1) : best),
    0,
  );
  if (rank === 0) return 0;

  return matchesDepartment(title, department) ? rank * 2 : rank;
}

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
