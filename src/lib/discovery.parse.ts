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
  /**
   * Whether the search result actually places this person at the company we
   * searched for. False means the source never said so — which is different
   * from saying they do not work there, and is surfaced as such.
   */
  employerConfirmed: boolean;
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

/**
 * Shortest page that could plausibly be a job posting, in characters.
 *
 * Measured against nine real postings: the smallest was 2,816 characters and
 * the median was over 7,000. A floor of 200 sits far below anything genuine
 * while still catching a shell.
 */
const MIN_READABLE_CHARS = 200;

/** Pages that render entirely in the browser and say so in the HTML. */
const NEEDS_JS =
  /enable javascript|requires javascript|javascript is (?:dis|not en)abled|please enable/i;

/**
 * Did we fetch a page, or just its wrapper?
 *
 * Workday renders postings client-side, so fetching one returns HTTP 200 with
 * valid HTML and **zero characters of text**. Every error check passes and the
 * model is handed nothing, which is the auth-wall failure through a different
 * door: an empty success is not a success, and a model given no content will
 * describe something anyway.
 *
 * Job-content words veto the check, so a terse-but-real posting is still read.
 */
export function looksUnreadable(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;

  /*
   * The JavaScript notice is checked BEFORE the job-content veto, and the order
   * is the whole point.
   *
   * It used to be the other way round, and Apple's posting slipped through for
   * two sessions: the page says "Please enable Javascript in your browser" and
   * carries no description at all, but its legal boilerplate mentions benefits
   * and compensation, so JOB_SIGNAL vetoed first and the shell was declared
   * readable. department, seniority and summary were then derived from a
   * navigation menu, and nothing surfaced it because company and role come from
   * the title tag.
   *
   * A page that announces it needs a browser is not a posting, whatever else it
   * happens to contain.
   */
  if (NEEDS_JS.test(t)) return true;

  // Real posting language settles the rest, whatever the length — that veto is
  // what keeps a terse but genuine posting readable.
  if (JOB_SIGNAL.test(t)) return false;

  return t.length < MIN_READABLE_CHARS;
}

/**
 * Phrases an ATS shows where the description used to be, once a req closes.
 *
 * Deliberately narrow. Each names the posting's own state — "the job you are
 * trying to apply for has been filled" is Bechtel's, verbatim. A live posting
 * can mention "closing date" or "we have filled many roles" in prose, so
 * anything that vague is left out.
 */
const FILLED_PHRASES = [
  /\bthe job (?:you are|you're) trying to apply for has been filled\b/i,
  /\bthis (?:job|position|posting|requisition|vacancy) (?:has been|is) (?:filled|closed|expired)\b/i,
  /\bno longer (?:accepting applications|available|open|active)\b/i,
  /\bthis (?:job|position|posting) is no longer\b/i,
  /\bapplications (?:for this (?:role|position) )?(?:are|have) closed\b/i,
  /\bposting (?:has )?expired\b/i,
  /\bthis (?:role|opening) has been filled\b/i,
];

/**
 * Has this posting already been filled or closed?
 *
 * The one case where a definite negative beats a null. "This posting has been
 * filled" tells the user to stop, which is more useful than any score computed
 * from the page furniture that replaced the description — and that furniture is
 * exactly what an ATS leaves behind, so without this the model describes a
 * benefits blurb and reports it as the job.
 */
export function looksFilled(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return FILLED_PHRASES.some((re) => re.test(t));
}

/**
 * Titles a jobs *listing* uses: a count, a keyword and usually a place.
 *
 * LinkedIn serves a search page in response to an unauthenticated fetch of a
 * /jobs/view/<id> URL, so the URL is right and the response is wrong — the URL
 * check cannot catch it by construction. The title can: a real posting is
 * titled after one role at one company, a listing is titled after how many it
 * found.
 *
 * Anchored to the start and requires the count to be immediately followed by
 * job words, so a genuine posting whose title contains a number — "Engineer II",
 * "5G Systems Engineer", "Analyst, 2026 Graduate Program" — cannot trip it.
 */
const LISTING_TITLE = /^\s*[\d,.]+\+?\s+[\w\s/&'-]{0,40}\bjobs\b/i;

/**
 * Is this page a jobs listing rather than one posting, judged by its title?
 *
 * Separate from the URL check because they fail differently and neither
 * subsumes the other.
 */
export function looksLikeListingTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  if (LISTING_TITLE.test(t)) return true;
  // "Jobs in Boston", "Search jobs at Acme" — a listing naming no single role.
  return /^\s*(?:search\s+)?jobs\b/i.test(t);
}

/**
 * Remove embedded configuration blobs before judging a page's text.
 *
 * Phenom-based career sites inline their whole theme configuration into the
 * HTML, and stripHtml removes tags but not a JSON object sitting in a text
 * node: one fixture came back 40% CSS variables by volume. Feeding that to a
 * model is feeding it nothing, expensively.
 *
 * Deliberately narrow. It removes runs that look like machine configuration —
 * many quoted key/value pairs, with the HTML-escaped quotes those blobs carry —
 * and leaves ordinary JSON alone, so a backend posting showing a config example
 * or a snippet in a code block keeps it.
 */
/** Escaped quotes closer than this belong to the same serialised object. */
const MAX_MARK_GAP = 80;
/** Fewer escaped quotes than this in a run is a quotation, not a config dump. */
const MIN_BLOB_MARKS = 10;

export function stripConfigBlobs(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";

  /*
   * Scans for dense runs of escaped quotes rather than matching balanced
   * braces, which was the first attempt and did not survive contact: the blob
   * on a real page was both nested deeper than the pattern allowed and cut
   * mid-object by the 20,000 character fetch cap, so there was no closing brace
   * to match at all.
   *
   * Density is the reliable signal. Serialised configuration puts a quoted key
   * every few characters; prose quoting JSON does not, and does it with real
   * quote characters rather than the HTML-escaped ones a dumped attribute
   * carries.
   */
  const marks: number[] = [];
  const re = /&#34;|&quot;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) marks.push(m.index);
  if (marks.length < MIN_BLOB_MARKS) return raw.replace(/\s+/g, " ").trim();

  // Group marks that sit close together; a group large enough is a blob.
  const cuts: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= marks.length; i++) {
    const broken = i === marks.length || marks[i]! - marks[i - 1]! > MAX_MARK_GAP;
    if (!broken) continue;
    if (i - start >= MIN_BLOB_MARKS) cuts.push([marks[start]!, marks[i - 1]! + 6]);
    start = i;
  }
  if (!cuts.length) return raw.replace(/\s+/g, " ").trim();

  let out = "";
  let cursor = 0;
  for (const [from, to] of cuts) {
    out += raw.slice(cursor, from) + " ";
    cursor = Math.min(to, raw.length);
  }
  out += raw.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Is this a jobs *search* or listing page rather than one posting?
 *
 * LinkedIn serves both from similar-looking URLs, and a search page carries
 * dozens of other companies' roles. Fed to the model it produces a plausible
 * company and role belonging to whichever listing happened to appear first.
 *
 * Judged on the URL, since that is unambiguous: /jobs/view/<id> is a posting,
 * /jobs/search and the keyword-listing forms are not. Content heuristics were
 * rejected — a real posting legitimately shows "similar jobs" alongside it.
 */
export function looksLikeJobSearchPage(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^(?:www|[a-z]{2})\./, "");
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");

  if (host === "linkedin.com") {
    // The only LinkedIn shape that is a single posting.
    if (/^\/jobs\/view\/[^/]+$/.test(path)) return false;
    if (path === "/jobs" || path.startsWith("/jobs/search")) return true;
    // "/jobs/<keyword>-jobs-<place>" and "/jobs/<company>-jobs" are listings.
    if (path.startsWith("/jobs/") && /-jobs(?:-|$)/.test(path)) return true;
    return false;
  }

  // Generic search paths on any host.
  return /^\/(?:jobs|careers)?\/?search\b/.test(path) || path.endsWith("/search-jobs");
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
 * Titles senior enough that a referral is worth asking for.
 *
 * Membership only — the *weight* lives in SENIORITY_WEIGHT, because rank order
 * and referral usefulness are not the same curve.
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

/**
 * How useful a referral from this level actually is.
 *
 * Not a rank. Seniority ordering rises monotonically to the top of the org
 * chart; referral usefulness does not. It peaks around senior IC and line
 * manager — close enough to the team to vouch credibly, senior enough for the
 * vouch to carry — and falls away above that. A VP of Software Engineering
 * will not refer a stranger, and asking costs the applicant the attempt.
 *
 * Executives are weighted low rather than excluded. They are still real people
 * on the team and occasionally the right ask; they simply should not outrank
 * the engineer who would actually reply.
 */
const SENIORITY_WEIGHT: Record<string, number> = {
  senior: 6,
  "sr.": 6,
  lead: 7,
  staff: 7,
  manager: 7,
  principal: 8,
  architect: 7,
  distinguished: 6,
  "head of": 5,
  director: 4,
  vp: 2,
  "vice president": 2,
  chief: 1,
};

/**
 * Disciplines that are genuinely different jobs inside one department.
 *
 * DEPARTMENT_HINTS buckets both silicon and web work under "engineering",
 * which is why a Hardware Engineering Director scored as a department *match*
 * on a software requisition and outranked the software engineer who would have
 * answered. This axis is what makes that a mismatch.
 *
 * Checked before the coarse buckets, since the specific reading should win.
 */
const DISCIPLINES: Record<string, string[]> = {
  hardware: [
    "hardware",
    "silicon",
    "asic",
    "rtl",
    "analog",
    "pcb",
    "electrical",
    "mechanical",
    "thermal",
    "semiconductor",
    "chip design",
    "firmware",
  ],
  software: [
    "software",
    "backend",
    "back-end",
    "frontend",
    "front-end",
    "full stack",
    "fullstack",
    "web",
    "mobile",
    "ios",
    "android",
    "cloud",
    "devops",
    "sre",
    "application",
  ],
};

function disciplineOf(text: string): string | null {
  const t = normalize(text);
  if (!t) return null;
  for (const [name, hints] of Object.entries(DISCIPLINES)) {
    if (hints.some((h) => t.includes(h))) return name;
  }
  return null;
}

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
export type DepartmentFit = "match" | "mismatch" | "unknown";

/**
 * Three-valued, because "wrong team" and "cannot tell" deserve different
 * answers.
 *
 * The old boolean collapsed them: an unrecognised title and a title from
 * another department both returned false, so a genuine mismatch was never
 * penalised beyond losing its bonus. Unknown stays neutral — most headlines
 * name no function at all, and punishing silence would rank the majority below
 * a signal they never carried.
 *
 * roleTitle is consulted alongside department because analyzeJob reports both
 * a software and a hardware requisition as "Engineering"; only the role text
 * says which.
 */
export function departmentFit(
  title: string,
  department: string | null,
  roleTitle?: string | null,
): DepartmentFit {
  const t = normalize(title);
  if (!t) return "unknown";

  // Discipline first: the specific reading beats the coarse bucket.
  const jobDiscipline = disciplineOf(`${department ?? ""} ${roleTitle ?? ""}`);
  const theirDiscipline = disciplineOf(t);
  if (jobDiscipline && theirDiscipline) {
    return jobDiscipline === theirDiscipline ? "match" : "mismatch";
  }

  if (!department) return "unknown";
  const d = normalize(department);
  const bucket = Object.entries(DEPARTMENT_HINTS).find(
    ([name, hints]) => d.includes(name) || hints.some((h) => d.includes(h)),
  );
  if (!bucket) return "unknown";
  if (bucket[1].some((h) => t.includes(h))) return "match";

  // Names another department outright — a mismatch, not a shrug.
  const otherBucket = Object.entries(DEPARTMENT_HINTS).find(
    ([name, hints]) => name !== bucket[0] && hints.some((h) => t.includes(h)),
  );
  return otherBucket ? "mismatch" : "unknown";
}

/** Back-compatible boolean: only an explicit mismatch counts as "no". */
export function matchesDepartment(title: string, department: string | null): boolean {
  return departmentFit(title, department) !== "mismatch";
}

/**
 * Rank a referral candidate. Higher is better; 0 means "don't show".
 *
 * Seniority contributes by rank so a Director outranks a Senior, and a
 * department match roughly doubles the score — a senior person on the actual
 * team is worth more than a more senior stranger elsewhere in the company.
 */
/** Department fit as a multiplier: right team doubles, wrong team halves. */
const FIT_MULTIPLIER: Record<DepartmentFit, number> = {
  match: 2,
  unknown: 1,
  mismatch: 0.5,
};

export function scoreReferralCandidate(
  title: string,
  department: string | null,
  roleTitle?: string | null,
): number {
  const t = normalize(title);
  if (!t || isRecruiterTitle(t)) return 0;

  // Highest-weighted matching term wins, so "Senior Director" is read as the
  // director it is rather than the senior it also says.
  const weight = SENIORITY_TERMS.reduce(
    (best, term) => (t.includes(term) ? Math.max(best, SENIORITY_WEIGHT[term] ?? 0) : best),
    0,
  );
  if (weight === 0) return 0;

  return weight * FIT_MULTIPLIER[departmentFit(title, department, roleTitle)];
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

/* ============================================================================
 * Untrusted-input defenses.
 *
 * analyzeJob feeds arbitrary third-party job postings to a model. A posting is
 * attacker-controlled text, so anything the model derives from it is
 * attacker-influenced — including company_domain, which discoverContacts then
 * crawls for email addresses.
 *
 * That is the path that actually matters. The model never emits an email
 * address (AnalyzedJob has no such field), so it cannot fabricate one. What it
 * can do is name the wrong site as the employer, after which the crawler
 * harvests real addresses from a page the attacker controls — addresses that
 * genuinely appear in the fetched text and genuinely have a source URL, and so
 * would pass any "did we really find this?" check. The defense has to sit on
 * the domain, not on the email.
 * ========================================================================= */

export type DomainRejection =
  "malformed" | "ip_literal" | "private_range" | "non_public_tld" | "confusable" | "uncorroborated";

export interface DomainVerdict {
  ok: boolean;
  /** Canonical host when accepted, null when rejected. */
  domain: string | null;
  reason: DomainRejection | null;
}

/**
 * Suffixes that never identify a public company website. `.internal` matters
 * most: it passes normalizeDomain's shape test and is the conventional name for
 * cloud metadata services.
 */
const NON_PUBLIC_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "test",
  "example",
  "invalid",
  "onion",
];

/** Dotted-quad ranges that are not routable on the public internet. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Gate one: is this string shaped like a public company hostname at all?
 *
 * Unconditional — nothing corroborates its way past this. A posting that
 * mentions "localhost" a hundred times still cannot make localhost the
 * employer.
 */
export function checkDomainFormat(raw: string): {
  domain: string | null;
  reason: DomainRejection | null;
} {
  /*
   * NFKC first. Without it, fullwidth and other compatibility forms survive to
   * the ASCII test below and read as ordinary characters to a human — ｅｘａｍｐｌｅ
   * folds to example, and anything that does not fold is caught as confusable.
   */
  const trimmed = (raw ?? "").normalize("NFKC").trim().toLowerCase();
  if (!trimmed) return { domain: null, reason: "malformed" };

  // Strip scheme/path/port/credentials before shape checks so an attacker can't
  // smuggle a host past them inside a URL.
  const bare = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^/@]*@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");

  if (!bare) return { domain: null, reason: "malformed" };

  /*
   * Homoglyph defense, both directions of the same attack.
   *
   * Raw Unicode: "аpple.com" with a Cyrillic а is a different host that renders
   * identically to Apple's. Punycode: the same host written xn--pple-43d.com is
   * pure ASCII and sails past every shape check below.
   *
   * Both are rejected rather than decoded and compared. Deciding whether an IDN
   * is confusable needs full Unicode script-mixing analysis, and the honest
   * trade is that a genuinely international company site is refused here and
   * falls back to the job URL host. That shows up in the logs as `confusable`,
   * so the cost is measurable rather than assumed.
   */
  if (/[^\x20-\x7e]/.test(bare)) return { domain: null, reason: "confusable" };
  if (bare.split(".").some((l) => l.startsWith("xn--"))) {
    return { domain: null, reason: "confusable" };
  }

  // IPv6, or any bracketed literal.
  if (bare.includes(":")) return { domain: null, reason: "ip_literal" };

  // Decimal (2130706433) and hex (0x7f000001) spellings of an IPv4 address.
  if (/^\d+$/.test(bare) || /^0x[0-9a-f]+$/.test(bare)) {
    return { domain: null, reason: "ip_literal" };
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    return { domain: null, reason: isPrivateIpv4(bare) ? "private_range" : "ip_literal" };
  }

  const labels = bare.split(".");
  if (labels.length < 2) return { domain: null, reason: "non_public_tld" };
  if (bare.length > 253) return { domain: null, reason: "malformed" };
  if (labels.some((l) => l.length === 0 || l.length > 63))
    return { domain: null, reason: "malformed" };
  if (labels.some((l) => !/^[a-z0-9-]+$/.test(l) || l.startsWith("-") || l.endsWith("-"))) {
    return { domain: null, reason: "malformed" };
  }

  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,24}$/.test(tld)) return { domain: null, reason: "non_public_tld" };

  for (const suffix of NON_PUBLIC_SUFFIXES) {
    if (bare === suffix || bare.endsWith(`.${suffix}`)) {
      return { domain: null, reason: "non_public_tld" };
    }
  }

  /*
   * Wildcard-DNS services (nip.io, sslip.io and friends) resolve
   * 169.254.169.254.nip.io straight back to the embedded address, so a public
   * TLD is not proof of a public target. Reject any host carrying a private
   * dotted quad in its leading labels.
   */
  for (let i = 0; i + 4 <= labels.length; i++) {
    const quad = labels.slice(i, i + 4).join(".");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(quad)) {
      return { domain: null, reason: isPrivateIpv4(quad) ? "private_range" : "ip_literal" };
    }
  }

  return { domain: bare, reason: null };
}

/**
 * Labels that describe a hosting role rather than an organisation.
 *
 * `careers.tufts.edu` is Tufts; `jobs.apple.com` is Apple. Skipping these is
 * what lets the check look at who actually owns the host.
 */
const HOSTING_LABELS = new Set([
  "www",
  "jobs",
  "job",
  "jobboards",
  "job-boards",
  "boards",
  "careers",
  "career",
  "apply",
  "recruiting",
  "recruit",
  "talent",
  "hiring",
  "hire",
  "work",
  "join",
  "portal",
  "apps",
  "app",
  "my",
  "secure",
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "io",
  "co",
]);

/**
 * Does this host plausibly belong to the company itself?
 *
 * Used for the job URL fallback, which cannot be corroborated the ordinary way:
 * the candidate domain *is* the job URL's host, so asking "does it match the
 * job URL" answers itself. Asking whether the company's name appears in the
 * host is the question with actual content.
 *
 * Checks every label, not just the first, because the owner is rarely the
 * leftmost one — `jobs.apple.com` is Apple's, `careers.tufts.edu` is Tufts'.
 * That is exactly how a university board gets caught: nothing in
 * `careers.tufts.edu` says Settlyfe.
 */
export function isCompanyOwnedHost(host: string, company: string | null | undefined): boolean {
  if (!host || !company) return false;
  const key = companyKey(company);
  if (key.length < 3) return false;

  for (const label of host.toLowerCase().split(".")) {
    if (HOSTING_LABELS.has(label)) continue;
    const clean = label.replace(/[^a-z0-9]/g, "");
    if (clean.length < 3) continue;
    if (key.includes(clean) || clean.includes(key)) return true;
  }
  return false;
}

/** Reduce a name to comparable letters, so "Acme, Inc." meets "acme". */
function companyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Gate two: did anything other than the model's say-so point at this domain?
 *
 * Independent of the format gate — both must pass. Corroboration alone is not
 * enough, because attacker-controlled text can corroborate anything it likes;
 * its job is only to catch a domain the model produced from thin air or from an
 * instruction embedded in the posting.
 */
export function isCorroboratedDomain(
  domain: string,
  context: { jobUrl?: string | null; company?: string | null },
): boolean {
  const { jobUrl, company } = context;

  /*
   * Note what is NOT consulted here: the text of the posting.
   *
   * "The domain appears in the fetched page" looks like corroboration and is
   * worthless, because in this threat model the attacker wrote the page. A
   * hostile posting that says "our website is attacker.com" corroborates itself
   * and the gate passes it. Measured, not assumed — it returned true before
   * this route was removed.
   *
   * What remains are the two signals the posting cannot forge on its own.
   */

  /*
   * A job URL is required, not merely preferred.
   *
   * On the paste path the user supplies a description and no link, so the
   * company name and the domain are both read out of the same block of text. A
   * name match there proves only that the text agrees with itself — the same
   * circularity as trusting the page, one step removed. Measured: a pasted
   * posting naming "Acme Corp" and acmecorp-careers.net was accepted.
   *
   * With no independent signal available, the safe answer is no domain. The
   * caller degrades to LinkedIn profiles and the people-search shortcut.
   */
  if (!jobUrl) return false;

  // 1. The host the user themselves chose to visit. Job boards excluded: their
  //    host says nothing about the employer.
  const host = hostFromUrl(jobUrl);
  if (host && !isJobBoard(host) && (host === domain || host.endsWith(`.${domain}`))) return true;

  /*
   * 2. The domain agrees with the company name the user is being shown.
   *
   * The attacker controls the company name too, but controlling it defeats the
   * deception: a posting that renames the employer to "Attacker Corp" no longer
   * passes as Acme. This catches the case that matters — the user believes they
   * are contacting Acme while the crawler is pointed somewhere else.
   */
  if (company) {
    const key = companyKey(company);
    const label = domain.split(".")[0] ?? "";
    if (key.length >= 3 && label.length >= 3 && (key.includes(label) || label.includes(key))) {
      return true;
    }
  }

  return false;
}

/**
 * Both gates, in order, returning the reason so the caller can log it.
 *
 * Rejection is not an error: the caller falls back to the job URL's own host,
 * and failing that the LinkedIn people-search shortcut. A bad domain costs the
 * user email discovery, never the whole result.
 */
export function validateCompanyDomain(
  raw: string | null | undefined,
  context: { jobUrl?: string | null; pageText?: string | null; company?: string | null } = {},
): DomainVerdict {
  if (!raw) return { ok: false, domain: null, reason: "malformed" };

  const { domain, reason } = checkDomainFormat(raw);
  if (!domain) return { ok: false, domain: null, reason };

  if (!isCorroboratedDomain(domain, context)) {
    return { ok: false, domain: null, reason: "uncorroborated" };
  }
  return { ok: true, domain, reason: null };
}

/**
 * Did this address actually occur in the text we fetched?
 *
 * A regression guard rather than a live defense: no model output path currently
 * produces an email, and this keeps it that way. Checks the raw source and its
 * tag-stripped form, so an address written as `a&#64;b.com` or split across
 * markup still counts as present.
 */
export function emailAppearsInSource(email: string, source: string): boolean {
  const needle = email.trim().toLowerCase();
  if (!needle || !source) return false;
  const haystack = source.toLowerCase();
  return haystack.includes(needle) || stripHtml(haystack).includes(needle);
}

/**
 * An address may only ship with the page it was found on.
 *
 * Deliberately not "every contact needs a source URL": a contact with no email
 * is the normal LinkedIn-only case, including the guaranteed fallback that
 * keeps a search from ever being a dead end. The invariant is narrower — an
 * email without provenance is what gets discarded.
 */
export function hasTraceableEmail(contact: {
  email?: string | null;
  email_source_url?: string | null;
}): boolean {
  if (!contact.email) return true;
  return Boolean(contact.email_source_url && contact.email_source_url.trim());
}

/** Hard ceiling on untrusted text handed to a model. */
export function capUntrusted(text: string, max: number): string {
  if (max <= 0 || !text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}

/**
 * Wrap untrusted content in delimiters the model is told to treat as data.
 *
 * The weakest layer here, and worth being honest about: a determined injection
 * can still talk its way past a prompt instruction. It earns its place by
 * making the boundary explicit and by stripping any copy of the delimiter out
 * of the content first — otherwise a posting could close the fence and write
 * outside it, which is the one failure mode this can actually prevent.
 */
export function fenceUntrusted(text: string, label: string): string {
  const open = `<<<${label}>>>`;
  const close = `<<</${label}>>>`;
  const scrubbed = (text ?? "").split(open).join(`(${label})`).split(close).join(`(/${label})`);
  return `${open}\n${scrubbed}\n${close}`;
}

/* ============================================================================
 * Alumni shortcuts.
 *
 * Not discovery. Shared school is the strongest predictor of a referral reply,
 * but the data to act on it is not in what this app fetches: of 45 profiles
 * sampled from real search results, 16% carried any education string at all,
 * and that string is a single entry rather than a history. Filtering on it
 * would report "no alumni" when the truth is "unknown", which is the failure
 * mode this codebase spends most of its effort avoiding.
 *
 * So this builds a link into the search that does work, and promises nothing
 * more. See IDEAS.md for the killed discovery feature and what would justify
 * revisiting it.
 * ========================================================================= */

/** Longest school name accepted, to keep a pasted essay out of a URL. */
const MAX_SCHOOL_LENGTH = 80;

/**
 * Split the user's schools field into individual institutions.
 *
 * One per line, not comma-separated: "University of California, San Diego"
 * contains a comma and would shatter into two useless fragments, and that is
 * exactly the kind of name this needs to survive.
 *
 * Abbreviations are not derived from full names. "UCSD" is not mechanically
 * recoverable from "University of California, San Diego" without a lookup
 * table covering every university on earth, and a wrong expansion is worse
 * than none. A user who searches by both forms adds both lines.
 */
export function parseSchools(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/\r?\n/)) {
    const school = piece.replace(/\s+/g, " ").trim();
    if (!school || school.length > MAX_SCHOOL_LENGTH) continue;
    const key = school.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(school);
  }
  return out;
}

/**
 * LinkedIn people search for one school's alumni at one company.
 *
 * Keyword-based rather than LinkedIn's structured `schoolFilter`, which keys on
 * numeric institution IDs this app has no way to resolve. Keywords are what a
 * person types by hand, and they work without a lookup.
 *
 * One school per URL: LinkedIn's handling of OR inside keywords is inconsistent
 * enough that a user with two degrees is better served by two reliable links
 * than one clever one.
 */
export function linkedInAlumniSearchUrl(company: string, school: string): string {
  const terms = [company, school]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    terms,
  )}&origin=GLOBAL_SEARCH_HEADER`;
}

/* ============================================================================
 * Country hints.
 *
 * Measured before building, across 40 LinkedIn profiles from 8 real discovery
 * queries: 33% carried a ccTLD subdomain, 67% were bare www. The structured
 * `Location:` field in a snippet appeared on 5%, and both values were cities
 * rather than countries — turning a city into a country is inference, so that
 * signal is not used at all.
 *
 * What a ccTLD tells you is where a profile was registered. Nothing more. It
 * does not say where the person lives, and it does not say which requisitions
 * they work on.
 * ========================================================================= */

/** Country of a candidate or role, or UNKNOWN when nothing said. */
export type CountryHint = string | null;

/**
 * Country implied by a LinkedIn profile URL's subdomain.
 *
 * `in.linkedin.com/in/...` returns "in"; a bare `www.linkedin.com` returns
 * null, which means unknown rather than US. Two thirds of profiles are bare,
 * and reading those as American would invent a signal for the majority.
 */
export function countryFromLinkedInUrl(url: string | null | undefined): CountryHint {
  if (!url) return null;
  const m = /^https?:\/\/([a-z]{2})\.linkedin\.com\//i.exec(url.trim());
  if (!m) return null;
  const code = m[1]!.toLowerCase();
  // "www" cannot reach here (three letters), but guard the shape anyway.
  return /^[a-z]{2}$/.test(code) ? code : null;
}

/** US state and territory codes, for spotting a bare "Millersport, OH". */
const US_STATES = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  "dc",
  "pr",
  "gu",
  "vi",
  "as",
  "mp",
]);

/** Country names and demonyms worth recognising in a posting's location. */
const COUNTRY_WORDS: Record<string, string> = {
  // Longer names first: the first match wins, so "united states" must be
  // tested before the bare "us" that also appears inside it.
  "united states": "us",
  usa: "us",
  "u.s.a.": "us",
  "u.s.": "us",
  america: "us",
  us: "us",
  "united kingdom": "uk",
  uk: "uk",
  england: "uk",
  scotland: "uk",
  wales: "uk",
  britain: "uk",
  india: "in",
  canada: "ca",
  australia: "au",
  germany: "de",
  france: "fr",
  spain: "es",
  ireland: "ie",
  netherlands: "nl",
  poland: "pl",
  singapore: "sg",
  japan: "jp",
  china: "cn",
  brazil: "br",
  mexico: "mx",
  "new zealand": "nz",
  "south africa": "za",
  uae: "ae",
  "united arab emirates": "ae",
  philippines: "ph",
  "hong kong": "hk",
};

/**
 * Country implied by a job posting's location string.
 *
 * Handles the shapes analyzeJob actually produces: "Millersport, OH",
 * "Remote (US)", "London, United Kingdom". A bare "Remote" with no country
 * returns null — remote from where is exactly the thing it does not say.
 */
export function countryFromJobLocation(location: string | null | undefined): CountryHint {
  if (!location) return null;
  const text = location.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  for (const [word, code] of Object.entries(COUNTRY_WORDS)) {
    if (new RegExp(`(^|[^a-z])${word.replace(/[.]/g, "\\.")}([^a-z]|$)`).test(text)) return code;
  }

  // Trailing US state code, with or without a ZIP: "Millersport, OH 43046".
  const state = /(?:^|,)\s*([a-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/.exec(text);
  if (state && US_STATES.has(state[1]!)) return "us";

  return null;
}

/**
 * Rank contribution from country agreement. Same +1, unknown 0, different -1.
 *
 * **No longer applied to any ranking.** Retained because the eval logs its
 * distribution, and a signal worth reopening later needs its measurement to
 * keep accruing.
 *
 * It was removed after the fixture set measured it: across 132 candidates,
 * `same` was 0. Not rare — unreachable. LinkedIn only exposes a ccTLD for
 * non-US profiles, so on a US requisition nothing can ever match and the
 * weight could only demote. The comment that shipped with it said as much
 * before there was evidence: both contacts known to be relevant in the
 * pipeline it came from were country-mismatched, a UK-based TA partner on a US
 * req and an India-registered recruiter staffing Arizona.
 *
 * Reading bare `www.` as a US hint was the alternative and is worse: it cannot
 * be verified from anything fetched here, and it would turn a 93% neutral
 * bucket into a reward, leaving the penalty on the remaining 7% as the only
 * discriminating effect — a nationality filter wearing a tiebreaker's clothes.
 *
 * What would justify reviving it: non-US postings in the fixture set, and a
 * measured `same` count that is not zero.
 */
export function countryRankDelta(candidate: CountryHint, job: CountryHint): -1 | 0 | 1 {
  if (!candidate || !job) return 0;
  return candidate === job ? 1 : -1;
}

/** Label for a mismatch, stating the signal rather than asserting a residence. */
export function countryMismatchLabel(candidate: CountryHint, job: CountryHint): string | null {
  if (!candidate || !job || candidate === job) return null;
  return `Profile registered in ${candidate.toUpperCase()} · posting is ${job.toUpperCase()}`;
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
/**
 * Tidy a headline that a search engine has already truncated.
 *
 * Result titles arrive cut to a fixed width, so they routinely end mid-word or
 * mid-company: "Project Engineering Manager at Bechtel ..." shipped to the UI
 * with the ellipsis attached. Two separate defects live in that one string —
 * the ellipsis itself, and the dangling " at <fragment>" it leaves behind.
 *
 * The employer fragment is dropped rather than repaired. "at Bechtel" from a
 * truncated string could equally be Bechtel, Bechtel Plant Machinery or
 * Bechtel Marine; keeping half a name and presenting it as the employer is a
 * guess wearing the clothes of a fact.
 */
export function tidyHeadline(raw: string): string {
  let out = (raw ?? "").trim();

  // Trailing ellipsis in any spelling, possibly repeated or spaced.
  out = out.replace(/[\s.…]*(?:\.{2,}|…)\s*$/u, "").trim();

  // A dangling employer clause left behind by the cut. Only stripped when it
  // sits at the very end, so "Recruiter at Bechtel, Houston" keeps its company.
  out = out.replace(/\s+(?:at|@)\s*$/i, "").trim();

  // Collapse whitespace and shed orphaned punctuation the cut left behind.
  return out
    .replace(/\s+/g, " ")
    .replace(/[\s,;:·|/-]+$/u, "")
    .trim();
}

/**
 * Does this text actually place the person at the company we searched for?
 *
 * A search for recruiters at one company returns profiles that merely mention
 * it, so the employer needs confirming rather than assuming. Matched on a
 * normalised leading token — "Bechtel" confirms "Bechtel Corporation" —
 * because the full legal name almost never appears in a headline.
 */
export function confirmsEmployer(text: string, company: string | null | undefined): boolean {
  if (!company) return false;
  const haystack = (text ?? "").toLowerCase();
  if (!haystack) return false;

  const key = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|company|co|group|plc|gmbh|sa|nv)\b\.?/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (key.length < 3) return false;

  // The distinctive leading word carries the identification; trailing filler
  // like "corporation" was stripped above precisely so it cannot be required.
  const lead = key.split(" ")[0] ?? "";
  return lead.length >= 3 && haystack.includes(lead);
}

/**
 * Keep only the people the source actually places at this company.
 *
 * A real run against a two-person startup returned four recruiters and eight
 * referrers, every one of them labelled "company not confirmed in source" —
 * people at Peloton, State Street, Google, Meta and a staffing firm, one with a
 * genuine published address belonging to none of them. Rendering those with a
 * caveat still renders them, and a caveat is not a defence when every card
 * carries it.
 *
 * An unconfirmed profile is not evidence of anything. Dropping the lot and
 * saying so is the honest output, and the caller falls through to the LinkedIn
 * people-search shortcut, which is a real next step rather than twelve
 * strangers.
 */
export function confirmedOnly<T extends { employerConfirmed: boolean }>(
  profiles: readonly T[],
): T[] {
  return profiles.filter((p) => p.employerConfirmed);
}

/**
 * Queries for "anyone who works here", used when no recruiter can be confirmed.
 *
 * At a two-person startup there is no recruiter and no director, so a search
 * built from titles falls through to generic matches at unrelated companies —
 * a real run returned twelve strangers for a company whose entire engineering
 * team is findable in one search.
 *
 * Measured before building. Bare `<company> linkedin.com/in` returned seven
 * profiles at a seed startup, all seven confirmed, including the exact engineer
 * found by hand. A wordier variant ("<company> Inc employees") returned one
 * profile and zero confirmed, so the plain form is the one kept.
 *
 * The role-qualified variant exists for companies whose name is an ordinary
 * word: "Warp" alone surfaced one profile, "Warp dev engineer" surfaced three.
 */
export function companyPeopleQueries(company: string, roleTitle?: string | null): string[] {
  const name = (company ?? "").replace(/\s+/g, " ").trim();
  if (!name) return [];
  const queries = [`${name} linkedin.com/in`];
  const role = (roleTitle ?? "").replace(/\s+/g, " ").trim();
  if (role) queries.push(`${name} ${role} linkedin.com/in`);
  return queries;
}

/** Shown in place of an employer when the source never confirmed one. */
export const EMPLOYER_UNCONFIRMED = "company not confirmed in source";

export function parseLinkedInTitle(rawTitle: string): { name: string; title: string } {
  const cleaned = tidyHeadline(rawTitle.replace(/\s*\|\s*LinkedIn.*$/i, ""));
  const parts = cleaned.split(/\s+[-–—]\s+/);
  return {
    name: tidyHeadline(parts[0] ?? cleaned),
    title: tidyHeadline(parts.slice(1).join(" – ")),
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
