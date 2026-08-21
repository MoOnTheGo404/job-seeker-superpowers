import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE,
  isProfileEmpty,
  MAX_ENTRIES,
  MAX_FIELD,
  MAX_LIST,
  normalizeProfile,
  planLocalMigration,
  profileToPrompt,
  type ApplicantProfile,
} from "./profile";

const profile = (over: Partial<ApplicantProfile> = {}): ApplicantProfile => ({
  ...EMPTY_PROFILE,
  ...over,
});

describe("normalizeProfile", () => {
  it("keeps well-formed input intact", () => {
    const p = normalizeProfile({
      schools: ["UC San Diego"],
      education: "BS Computer Science, 2026",
      skills: ["Go", "TypeScript"],
      experience: [{ title: "Backend Engineer at Acme", description: "Built the payments API." }],
      notes: "Available immediately.",
    });
    expect(p.schools).toEqual(["UC San Diego"]);
    expect(p.experience).toHaveLength(1);
    expect(p.skills).toEqual(["Go", "TypeScript"]);
  });

  it("never throws on junk, whatever shape it arrives in", () => {
    // Runs against rows from older versions and localStorage a user may have
    // edited by hand.
    for (const junk of [null, undefined, 42, "a string", [], { schools: "not a list" }]) {
      expect(() => normalizeProfile(junk)).not.toThrow();
    }
    expect(normalizeProfile(null)).toEqual(EMPTY_PROFILE);
    expect(normalizeProfile({ schools: "not a list" }).schools).toEqual([]);
  });

  it("drops one bad entry rather than the whole profile", () => {
    // Discarding someone's entire background over a single malformed row is a
    // worse failure than dropping that row.
    const p = normalizeProfile({
      skills: ["Go"],
      experience: [{ title: "Real", description: "Kept." }, {}, { title: "", description: "" }],
    });
    expect(p.skills).toEqual(["Go"]);
    expect(p.experience).toEqual([{ title: "Real", description: "Kept." }]);
  });

  it("trims, collapses whitespace and removes duplicates case-insensitively", () => {
    const p = normalizeProfile({ skills: ["  Go  ", "go", "GO", "Rust"] });
    expect(p.skills).toEqual(["Go", "Rust"]);
    expect(normalizeProfile({ education: "  BS   CS  " }).education).toBe("BS CS");
  });

  it("caps lists, entries and field lengths", () => {
    const p = normalizeProfile({
      skills: Array.from({ length: MAX_LIST + 25 }, (_, i) => `skill-${i}`),
      experience: Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => ({
        title: `role-${i}`,
        description: "d",
      })),
      notes: "x".repeat(MAX_FIELD + 500),
    });
    expect(p.skills).toHaveLength(MAX_LIST);
    expect(p.experience).toHaveLength(MAX_ENTRIES);
    expect(p.notes).toHaveLength(MAX_FIELD);
  });

  it("keeps a half-filled entry, since one half still says something", () => {
    const p = normalizeProfile({ experience: [{ title: "Payments migration" }] });
    expect(p.experience).toEqual([{ title: "Payments migration", description: "" }]);
  });
});

describe("isProfileEmpty", () => {
  it("is true only when nothing usable is present", () => {
    expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true);
    expect(isProfileEmpty(profile({ notes: "anything" }))).toBe(false);
    expect(isProfileEmpty(profile({ schools: ["UCSD"] }))).toBe(false);
    expect(isProfileEmpty(profile({ experience: [{ title: "x", description: "" }] }))).toBe(false);
  });
});

describe("profileToPrompt", () => {
  it("omits empty sections rather than emitting bare headings", () => {
    // An empty heading invites the model to fill it, which is the fabrication
    // this codebase keeps designing against.
    const text = profileToPrompt(profile({ skills: ["Go"] }));
    expect(text).toBe("Skills: Go");
    expect(text).not.toMatch(/Education|Schools/);
  });

  it("produces nothing at all for an empty profile", () => {
    expect(profileToPrompt(EMPTY_PROFILE)).toBe("");
  });

  it("labels an entry that has no description", () => {
    expect(profileToPrompt(profile({ experience: [{ title: "Payments", description: "" }] }))).toBe(
      "Payments",
    );
  });
});

describe("planLocalMigration", () => {
  const local = (background: string | null, schools: string | null = null) => ({
    background,
    schools,
  });

  it("promotes local values into an empty server profile", () => {
    const plan = planLocalMigration(
      EMPTY_PROFILE,
      local("4 years backend Go", "UCSD\nUC San Diego"),
    );
    expect(plan.action).toBe("migrate");
    if (plan.action !== "migrate") throw new Error("unreachable");
    expect(plan.profile.schools).toEqual(["UCSD", "UC San Diego"]);
    expect(plan.profile.notes).toBe("4 years backend Go");
  });

  it("puts the old prose in notes rather than guessing at structure", () => {
    // The legacy field was one blob. Splitting it into education and
    // experience would be inference, which is refused everywhere else here.
    const plan = planLocalMigration(EMPTY_PROFILE, local("BS CS 2026; led payments migration"));
    if (plan.action !== "migrate") throw new Error("expected migrate");
    expect(plan.profile.notes).toContain("led payments migration");
    expect(plan.profile.education).toBe("");
    expect(plan.profile.experience).toEqual([]);
  });

  it("is safe to run twice: the second run has nothing to do", () => {
    const first = planLocalMigration(EMPTY_PROFILE, local("4 years backend Go"));
    if (first.action !== "migrate") throw new Error("expected migrate");
    // After the write, the server is no longer empty and local was cleared.
    const second = planLocalMigration(first.profile, local(null, null));
    expect(second).toEqual({ action: "skip", reason: "server-has-data" });
  });

  it("never overwrites server data from a second device", () => {
    // The failure that matters: device B still holds an old localStorage copy
    // while device A has already written a richer profile.
    const onServer = profile({ skills: ["Go"], education: "BS CS" });
    const plan = planLocalMigration(onServer, local("stale local text", "OldSchool"));
    expect(plan.action).toBe("clear");
    expect(plan).not.toHaveProperty("profile");
  });

  it("clears rather than replays when a reload lands mid-migration", () => {
    // Written to the server but the local keys were not cleared yet. Re-running
    // must not write again, and must not resurrect the local copy.
    const written = profile({ notes: "4 years backend Go" });
    expect(planLocalMigration(written, local("4 years backend Go"))).toEqual({ action: "clear" });
  });

  it("does nothing when both sides are empty", () => {
    expect(planLocalMigration(EMPTY_PROFILE, local(null, null))).toEqual({
      action: "skip",
      reason: "nothing-local",
    });
    expect(planLocalMigration(EMPTY_PROFILE, local("   ", "  \n  "))).toEqual({
      action: "skip",
      reason: "nothing-local",
    });
  });

  it("migrates schools alone when there was no background text", () => {
    const plan = planLocalMigration(EMPTY_PROFILE, local(null, "UCSD"));
    if (plan.action !== "migrate") throw new Error("expected migrate");
    expect(plan.profile.schools).toEqual(["UCSD"]);
    expect(plan.profile.notes).toBe("");
  });

  it("is idempotent across many runs, not just two", () => {
    let server = EMPTY_PROFILE;
    const stale = local("original text", "UCSD");
    for (let i = 0; i < 5; i++) {
      const plan = planLocalMigration(server, stale);
      if (plan.action === "migrate") server = plan.profile;
    }
    // One promotion, then "clear" forever after — never a second write.
    expect(server.notes).toBe("original text");
    expect(server.schools).toEqual(["UCSD"]);
    expect(planLocalMigration(server, stale).action).toBe("clear");
  });
});
