import { describe, expect, it } from "vitest";
import {
  canTransition,
  elapsedDays,
  FOLLOW_UP_DAYS,
  isOutreachStatus,
  isStale,
  needsFollowUp,
  nextStatuses,
  OUTREACH_STATUSES,
  statusLabel,
  waitingLabel,
} from "./outreach.status";

describe("isOutreachStatus", () => {
  it("accepts every declared status", () => {
    for (const s of OUTREACH_STATUSES) expect(isOutreachStatus(s)).toBe(true);
  });

  it("rejects anything else, including the pre-migration spelling", () => {
    // Rows created before this feature carried 'draft', not 'drafted'. The
    // migration rewrites them; this guards against one slipping through.
    expect(isOutreachStatus("draft")).toBe(false);
    expect(isOutreachStatus("")).toBe(false);
    expect(isOutreachStatus(null)).toBe(false);
    expect(isOutreachStatus(7)).toBe(false);
  });
});

describe("canTransition", () => {
  it("allows the path a message actually takes", () => {
    expect(canTransition("drafted", "sent")).toBe(true);
    expect(canTransition("sent", "replied")).toBe(true);
    expect(canTransition("replied", "closed")).toBe(true);
  });

  it("allows undo back to drafted, for the copy-was-just-reading case", () => {
    expect(canTransition("sent", "drafted")).toBe(true);
  });

  it("allows a late reply after no_reply", () => {
    // People do reply after a fortnight. A tracker that cannot record that is
    // lying to its user.
    expect(canTransition("no_reply", "replied")).toBe(true);
  });

  it("refuses to skip sending", () => {
    expect(canTransition("drafted", "replied")).toBe(false);
    expect(canTransition("drafted", "no_reply")).toBe(false);
  });

  it("refuses to walk back out of a resolved state", () => {
    expect(canTransition("replied", "sent")).toBe(false);
    expect(canTransition("no_reply", "sent")).toBe(false);
    expect(canTransition("closed", "sent")).toBe(false);
    expect(canTransition("closed", "replied")).toBe(false);
  });

  it("treats closed as terminal", () => {
    expect(nextStatuses("closed")).toEqual([]);
  });

  it("rejects self-transitions so a double-submit cannot look valid", () => {
    for (const s of OUTREACH_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("rejects unknown statuses on either side", () => {
    expect(canTransition("draft", "sent")).toBe(false);
    expect(canTransition("sent", "archived")).toBe(false);
    expect(canTransition(null, undefined)).toBe(false);
  });
});

describe("elapsedDays and the staleness boundary", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const daysBefore = (n: number, hours = 0) =>
    new Date(now.getTime() - n * 86_400_000 - hours * 3_600_000).toISOString();

  it("counts whole elapsed days", () => {
    expect(elapsedDays(daysBefore(0), now)).toBe(0);
    expect(elapsedDays(daysBefore(3), now)).toBe(3);
    expect(elapsedDays(daysBefore(30), now)).toBe(30);
  });

  it("is stale at exactly N days", () => {
    // Inclusive on purpose: a full week has passed, and holding it back
    // another day helps nobody.
    expect(isStale(daysBefore(FOLLOW_UP_DAYS), now)).toBe(true);
  });

  it("is not stale at N-1 days", () => {
    expect(isStale(daysBefore(FOLLOW_UP_DAYS - 1), now)).toBe(false);
  });

  it("is stale at N+1 days", () => {
    expect(isStale(daysBefore(FOLLOW_UP_DAYS + 1), now)).toBe(true);
  });

  it("is not stale one hour short of the boundary", () => {
    // The tightest case: 6 days 23 hours must not qualify.
    expect(isStale(daysBefore(FOLLOW_UP_DAYS - 1, 23), now)).toBe(false);
  });

  it("honours a custom window", () => {
    expect(isStale(daysBefore(3), now, 3)).toBe(true);
    expect(isStale(daysBefore(3), now, 4)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as not stale", () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale(undefined, now)).toBe(false);
    expect(isStale("not a date", now)).toBe(false);
    expect(elapsedDays(null, now)).toBeNull();
  });

  it("never calls a future timestamp stale", () => {
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
    expect(isStale(tomorrow, now)).toBe(false);
  });
});

describe("timezone handling", () => {
  it("gives the same answer whatever offset the timestamp is written in", () => {
    // Identical instants, three spellings. Storing timestamptz means all of
    // these can arrive from Postgres depending on client settings.
    const now = new Date("2026-03-08T12:00:00Z");
    const utc = "2026-03-01T12:00:00Z";
    const newYork = "2026-03-01T07:00:00-05:00";
    const kolkata = "2026-03-01T17:30:00+05:30";

    expect(elapsedDays(utc, now)).toBe(7);
    expect(elapsedDays(newYork, now)).toBe(7);
    expect(elapsedDays(kolkata, now)).toBe(7);
  });

  it("does not drift across a DST transition", () => {
    // US clocks spring forward on 2026-03-08. Counting calendar days in local
    // time would lose an hour here and could report 6; absolute elapsed time
    // cannot.
    const sent = "2026-03-04T12:00:00Z";
    const sevenLater = new Date("2026-03-11T12:00:00Z");
    expect(elapsedDays(sent, sevenLater)).toBe(7);
    expect(isStale(sent, sevenLater)).toBe(true);

    // And one hour before the boundary it is still not stale, DST or not.
    const justShy = new Date("2026-03-11T11:00:00Z");
    expect(isStale(sent, justShy)).toBe(false);
  });

  it("does not drift across the southern-hemisphere transition either", () => {
    // Australian clocks fall back on 2026-04-05, the opposite direction.
    const sent = "2026-04-01T22:00:00Z";
    const sevenLater = new Date("2026-04-08T22:00:00Z");
    expect(elapsedDays(sent, sevenLater)).toBe(7);
  });

  it("accepts a Date as readily as an ISO string", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const sent = new Date("2026-08-11T12:00:00Z");
    expect(elapsedDays(sent, now)).toBe(7);
    expect(elapsedDays(sent.toISOString(), now)).toBe(7);
  });
});

describe("needsFollowUp", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const longAgo = "2026-08-01T12:00:00Z";
  const yesterday = "2026-08-17T12:00:00Z";

  it("surfaces a sent message that has gone quiet", () => {
    expect(needsFollowUp({ status: "sent", sent_at: longAgo }, now)).toBe(true);
  });

  it("leaves a recently sent message alone", () => {
    expect(needsFollowUp({ status: "sent", sent_at: yesterday }, now)).toBe(false);
  });

  it("never surfaces a state that has already been resolved", () => {
    // Resurfacing these would train the user to ignore the list, which is the
    // exact failure this feature exists to avoid.
    for (const status of ["replied", "no_reply", "closed"] as const) {
      expect(needsFollowUp({ status, sent_at: longAgo }, now)).toBe(false);
    }
  });

  it("never surfaces a draft, even an ancient one", () => {
    expect(needsFollowUp({ status: "drafted", sent_at: null }, now)).toBe(false);
    expect(needsFollowUp({ status: "drafted", sent_at: longAgo }, now)).toBe(false);
  });

  it("ignores a sent row with no send time rather than guessing", () => {
    expect(needsFollowUp({ status: "sent", sent_at: null }, now)).toBe(false);
  });

  it("returns nothing for an empty pipeline", () => {
    const rows: { status: string; sent_at: string | null }[] = [];
    expect(rows.filter((r) => needsFollowUp(r, now))).toEqual([]);
  });
});

describe("labels", () => {
  it("names every status", () => {
    expect(statusLabel("no_reply")).toBe("No reply");
    for (const s of OUTREACH_STATUSES) expect(statusLabel(s).length).toBeGreaterThan(0);
  });

  it("phrases the wait in a way a list row can show", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    expect(waitingLabel("2026-08-18T09:00:00Z", now)).toBe("today");
    expect(waitingLabel("2026-08-17T09:00:00Z", now)).toBe("1 day ago");
    expect(waitingLabel("2026-08-01T12:00:00Z", now)).toBe("17 days ago");
  });

  it("says nothing when there is nothing to say", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    expect(waitingLabel(null, now)).toBeNull();
    expect(waitingLabel("2026-09-01T12:00:00Z", now)).toBeNull();
  });
});
