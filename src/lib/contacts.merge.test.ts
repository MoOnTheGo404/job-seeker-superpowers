import { describe, expect, it } from "vitest";
import {
  contactKey,
  normalizeLinkedInUrl,
  partitionForUpsert,
  type StoredContact,
} from "./contacts.merge";

const CANON = "https://linkedin.com/in/jane-doe";

describe("normalizeLinkedInUrl", () => {
  it("strips www from the host", () => {
    // 28 of 30 stored rows are in this shape, so this is the case that decides
    // whether existing contacts match on the next run.
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe")).toBe(CANON);
  });

  it("strips a country subdomain", () => {
    // LinkedIn serves one profile under every locale host. Treating them as
    // different people would duplicate a contact the moment a result came back
    // localised, orphaning any message already sent.
    expect(normalizeLinkedInUrl("https://in.linkedin.com/in/jane-doe")).toBe(CANON);
    expect(normalizeLinkedInUrl("https://uk.linkedin.com/in/jane-doe")).toBe(CANON);
  });

  it("forces https", () => {
    expect(normalizeLinkedInUrl("http://www.linkedin.com/in/jane-doe")).toBe(CANON);
  });

  it("drops a trailing slash", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe/")).toBe(CANON);
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe///")).toBe(CANON);
  });

  it("lowercases the path", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/Jane-Doe")).toBe(CANON);
  });

  it("discards query and hash", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe?trk=abc#exp")).toBe(CANON);
  });

  it("collapses every variant of one person to a single key", () => {
    // The case the whole feature turns on: if these produced different keys,
    // the upsert would miss and create duplicates.
    const variants = [
      "https://www.linkedin.com/in/jane-doe",
      "http://linkedin.com/in/Jane-Doe/",
      "https://in.linkedin.com/in/jane-doe?trk=public",
      "https://uk.linkedin.com/in/JANE-DOE/#about",
    ];
    expect(new Set(variants.map(normalizeLinkedInUrl)).size).toBe(1);
    expect(normalizeLinkedInUrl(variants[0]!)).toBe(CANON);
  });

  it("keeps genuinely different people apart", () => {
    expect(normalizeLinkedInUrl("https://linkedin.com/in/jane-doe-2")).not.toBe(CANON);
  });

  it("rejects anything that is not a LinkedIn profile URL", () => {
    expect(normalizeLinkedInUrl(null)).toBeNull();
    expect(normalizeLinkedInUrl("")).toBeNull();
    expect(normalizeLinkedInUrl("not a url")).toBeNull();
    expect(normalizeLinkedInUrl("https://example.com/in/jane")).toBeNull();
    expect(normalizeLinkedInUrl("https://www.linkedin.com")).toBeNull();
    expect(normalizeLinkedInUrl("https://www.linkedin.com/")).toBeNull();
    expect(normalizeLinkedInUrl("ftp://linkedin.com/in/jane")).toBeNull();
  });
});

describe("contactKey", () => {
  it("scopes identity to the target and the contact type", () => {
    // The same person can legitimately be both a recruiter row and a referrer
    // row, and the same person at two companies is two contacts.
    const a = contactKey("t1", "recruiter", "https://www.linkedin.com/in/jane-doe");
    const b = contactKey("t1", "referrer", "https://www.linkedin.com/in/jane-doe");
    const c = contactKey("t2", "recruiter", "https://www.linkedin.com/in/jane-doe");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("matches across URL formats", () => {
    expect(contactKey("t1", "recruiter", "https://in.linkedin.com/in/JANE-DOE/")).toBe(
      contactKey("t1", "recruiter", "https://www.linkedin.com/in/jane-doe"),
    );
  });

  it("is null when there is nothing stable to key on", () => {
    expect(contactKey("t1", "recruiter", null)).toBeNull();
    expect(contactKey("", "recruiter", "https://linkedin.com/in/jane-doe")).toBeNull();
  });
});

describe("partitionForUpsert", () => {
  const person = (linkedin_url: string | null, name = "x") => ({ linkedin_url, name });
  const stored = (id: string, linkedin_url: string | null): StoredContact => ({ id, linkedin_url });

  it("routes keyed people to upsert and placeholders to insert", () => {
    const plan = partitionForUpsert(
      [person("https://www.linkedin.com/in/jane-doe"), person(null, "Recruiting team")],
      [],
    );
    expect(plan.upsertable).toHaveLength(1);
    expect(plan.unkeyed).toHaveLength(1);
    expect(plan.unkeyed[0]!.name).toBe("Recruiting team");
  });

  it("collapses duplicate formats of one person into a single upsert", () => {
    const plan = partitionForUpsert(
      [
        person("https://www.linkedin.com/in/jane-doe"),
        person("https://in.linkedin.com/in/JANE-DOE/"),
      ],
      [],
    );
    expect(plan.upsertable).toHaveLength(1);
  });

  it("never marks a keyed stored row deletable, even if this run missed them", () => {
    // The bug being fixed. Someone dropping out of search results is not
    // evidence they left the company, and deleting them takes any message
    // sent to them with it.
    const plan = partitionForUpsert(
      [person("https://www.linkedin.com/in/someone-else")],
      [stored("keep", "https://www.linkedin.com/in/jane-doe")],
    );
    expect(plan.deletableExistingIds).toEqual([]);
  });

  it("marks only unkeyed stored rows deletable", () => {
    const plan = partitionForUpsert(
      [],
      [
        stored("real", "https://www.linkedin.com/in/jane-doe"),
        stored("placeholder", null),
        stored("junk", "not a url"),
      ],
    );
    expect(plan.deletableExistingIds.sort()).toEqual(["junk", "placeholder"]);
  });

  it("handles an empty discovery run without deleting anyone real", () => {
    const plan = partitionForUpsert([], [stored("real", "https://linkedin.com/in/jane-doe")]);
    expect(plan).toEqual({ upsertable: [], unkeyed: [], deletableExistingIds: [] });
  });
});
