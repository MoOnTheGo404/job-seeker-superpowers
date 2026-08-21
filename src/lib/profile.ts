/**
 * The applicant's own profile: the only facts a draft may state about them.
 *
 * Pure — no network, no clock, no storage. Lives here so the shape, the
 * validation and the one-time migration off localStorage are all testable
 * without a browser or a database.
 *
 * Structured rather than one prose blob, because matching a profile against a
 * posting has to compare parts. A paragraph can only be searched; a list of
 * entries can be scored.
 */

/** Longest any single free-text field may be, in characters. */
export const MAX_FIELD = 2_000;
/** Longest a short label may be — a school, a skill, an entry title. */
export const MAX_LABEL = 200;
/** Most experience or project entries kept. */
export const MAX_ENTRIES = 20;
/** Most skills or schools kept. */
export const MAX_LIST = 50;

export interface ExperienceEntry {
  /** "Backend Engineer at Acme", "Payments migration". */
  title: string;
  /** One or two lines. What was built, what changed. */
  description: string;
}

export interface ApplicantProfile {
  /** Institutions, one per entry. Both "UC San Diego" and "UCSD" may appear. */
  schools: string[];
  /** Free text: degree, graduation, coursework. */
  education: string;
  skills: string[];
  experience: ExperienceEntry[];
  /** Anything structured fields do not capture. Optional by design. */
  notes: string;
}

export const EMPTY_PROFILE: ApplicantProfile = {
  schools: [],
  education: "",
  skills: [],
  experience: [],
  notes: "",
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Trim, drop blanks, drop case-insensitive duplicates, cap the length. */
function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanText(item, MAX_LABEL);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Coerce anything into a valid profile.
 *
 * Never throws and never rejects a whole profile over one bad field. This runs
 * against rows written by older versions of the app and against localStorage a
 * user may have edited by hand; discarding someone's entire background because
 * one entry is malformed would be a worse failure than dropping that entry.
 */
export function normalizeProfile(input: unknown): ApplicantProfile {
  const raw = (input ?? {}) as Record<string, unknown>;

  const experience: ExperienceEntry[] = [];
  if (Array.isArray(raw["experience"])) {
    for (const item of raw["experience"]) {
      const entry = (item ?? {}) as Record<string, unknown>;
      const title = cleanText(entry["title"], MAX_LABEL);
      const description = cleanText(entry["description"], MAX_FIELD);
      // An entry with neither half says nothing and is dropped.
      if (!title && !description) continue;
      experience.push({ title, description });
      if (experience.length >= MAX_ENTRIES) break;
    }
  }

  return {
    schools: cleanList(raw["schools"], MAX_LIST),
    education: cleanText(raw["education"], MAX_FIELD),
    skills: cleanList(raw["skills"], MAX_LIST),
    experience,
    notes: cleanText(raw["notes"], MAX_FIELD),
  };
}

/** True when the profile carries nothing a draft could use. */
export function isProfileEmpty(profile: ApplicantProfile): boolean {
  return (
    profile.schools.length === 0 &&
    profile.skills.length === 0 &&
    profile.experience.length === 0 &&
    !profile.education &&
    !profile.notes
  );
}

/**
 * Flatten a profile into the prose the drafter consumes.
 *
 * The model still receives text, so this is where structure is spent. Empty
 * sections are omitted rather than sent as headings with nothing under them —
 * an empty heading invites the model to fill it, which is the fabrication this
 * codebase keeps designing against.
 */
export function profileToPrompt(profile: ApplicantProfile): string {
  const parts: string[] = [];
  if (profile.education) parts.push(`Education: ${profile.education}`);
  if (profile.schools.length) parts.push(`Schools: ${profile.schools.join(", ")}`);
  if (profile.skills.length) parts.push(`Skills: ${profile.skills.join(", ")}`);
  for (const entry of profile.experience) {
    const label = entry.title || "Experience";
    parts.push(entry.description ? `${label}: ${entry.description}` : label);
  }
  if (profile.notes) parts.push(profile.notes);
  return parts.join("\n");
}

/* ------------------------------------------------------- localStorage migration */

export const LEGACY_BACKGROUND_KEY = "reachpoint:applicant-background";
export const LEGACY_SCHOOLS_KEY = "reachpoint:applicant-schools";

export interface LegacyLocalData {
  background: string | null;
  schools: string | null;
}

export type MigrationDecision =
  /** Write this profile to the server, then clear the local keys. */
  | { action: "migrate"; profile: ApplicantProfile }
  /** Nothing to move; clear the local keys if they exist. */
  | { action: "clear" }
  /** Leave both server and local storage exactly as they are. */
  | { action: "skip"; reason: "server-has-data" | "nothing-local" };

/**
 * Decide what a first load after deploy should do with legacy local values.
 *
 * Safe to run twice, and that is the whole point. The app may load on a second
 * device, or a reload may land mid-migration, and neither may overwrite server
 * data with a stale local copy.
 *
 * The rule is one-directional: local data is only ever promoted into an *empty*
 * server profile. Once the server holds anything, it wins permanently and the
 * local copy is only cleared, never replayed. That makes the operation
 * idempotent without needing a flag, a timestamp or a lock — the server's own
 * emptiness is the guard.
 */
export function planLocalMigration(
  server: ApplicantProfile,
  local: LegacyLocalData,
): MigrationDecision {
  const parsedSchools = (local.schools ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const background = (local.background ?? "").trim();
  const hasLocal = Boolean(background) || parsedSchools.length > 0;

  // Server data always wins. A second device running this must not clobber
  // edits made on the first.
  if (!isProfileEmpty(server)) {
    return hasLocal ? { action: "clear" } : { action: "skip", reason: "server-has-data" };
  }

  if (!hasLocal) return { action: "skip", reason: "nothing-local" };

  /*
   * The old background was one prose blob with no structure to recover, so it
   * becomes `notes` rather than being split by guesswork. Inventing an
   * education or an experience entry out of a paragraph would be exactly the
   * inference this codebase refuses elsewhere.
   */
  return {
    action: "migrate",
    profile: normalizeProfile({ schools: parsedSchools, notes: background }),
  };
}
