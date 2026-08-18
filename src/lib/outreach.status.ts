/**
 * Outreach lifecycle: the state machine and the follow-up predicate.
 *
 * Pure by design, like discovery.parse.ts — no network, no environment, no
 * ambient clock. `now` is always passed in, which is what makes the boundary
 * and timezone behaviour testable rather than hopeful.
 *
 * The rule shaping all of this: a tracker that depends on the user remembering
 * to come back and update it goes stale and dies. Almost every transition here
 * is meant to be driven by something the user was doing anyway — copying a
 * draft, opening a mail client — leaving exactly one that genuinely requires a
 * decision: whether someone replied.
 */

export const OUTREACH_STATUSES = ["drafted", "sent", "replied", "no_reply", "closed"] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/**
 * Days after sending before a message is considered to be waiting.
 *
 * Seven is a week: long enough not to nag someone who is simply busy, short
 * enough that a follow-up still reads as attentive rather than stale.
 */
export const FOLLOW_UP_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Legal moves.
 *
 * `sent -> drafted` exists for the undo affordance: copying a draft marks it
 * sent, and a user who was only re-reading it needs a way back that also
 * clears sent_at.
 *
 * `no_reply -> replied` exists because people do reply late, and a tracker
 * that cannot record that is lying. `closed` is the only truly terminal
 * state.
 */
const TRANSITIONS: Record<OutreachStatus, readonly OutreachStatus[]> = {
  drafted: ["sent", "closed"],
  sent: ["drafted", "replied", "no_reply", "closed"],
  replied: ["closed"],
  no_reply: ["replied", "closed"],
  closed: [],
};

export function isOutreachStatus(value: unknown): value is OutreachStatus {
  return typeof value === "string" && (OUTREACH_STATUSES as readonly string[]).includes(value);
}

/** Statuses reachable from here, for building controls without hardcoding. */
export function nextStatuses(from: OutreachStatus): readonly OutreachStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Is this move allowed?
 *
 * Self-transitions are rejected: re-sending the same status is a no-op the
 * caller should not be writing to the database, and treating it as valid hides
 * double-submits.
 */
export function canTransition(from: unknown, to: unknown): boolean {
  if (!isOutreachStatus(from) || !isOutreachStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * Whole days elapsed since an instant, or null if there isn't one.
 *
 * Deliberately absolute elapsed time rather than calendar arithmetic. Counting
 * calendar days in local time drifts by an hour across a DST boundary and by
 * a whole day across a UTC offset, so "7 days ago" would mean different things
 * in March and in July, and different things again for a user in Auckland.
 * Subtracting epoch milliseconds has neither problem.
 */
export function elapsedDays(sentAt: string | Date | null | undefined, now: Date): number | null {
  if (!sentAt) return null;
  const then = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now.getTime() - ms) / DAY_MS);
}

/**
 * Has this been waiting long enough to chase?
 *
 * Boundary is inclusive: a message sent exactly seven 24-hour periods ago has
 * had its full week, and hiding it for another day serves nobody. A timestamp
 * in the future — clock skew, a bad import — is never stale.
 */
export function isStale(
  sentAt: string | Date | null | undefined,
  now: Date,
  days: number = FOLLOW_UP_DAYS,
): boolean {
  const elapsed = elapsedDays(sentAt, now);
  if (elapsed === null) return false;
  return elapsed >= days;
}

/**
 * The follow-up list predicate.
 *
 * Only `sent` qualifies. A draft was never sent, and replied/no_reply/closed
 * have all been resolved one way or another — resurfacing them would train the
 * user to ignore the list, which is the failure this feature exists to avoid.
 */
export function needsFollowUp(
  row: { status?: unknown; sent_at?: string | Date | null },
  now: Date,
  days: number = FOLLOW_UP_DAYS,
): boolean {
  if (row.status !== "sent") return false;
  return isStale(row.sent_at ?? null, now, days);
}

/** Short human label for a status, for badges and inline lists. */
export function statusLabel(status: OutreachStatus): string {
  switch (status) {
    case "drafted":
      return "Draft";
    case "sent":
      return "Sent";
    case "replied":
      return "Replied";
    case "no_reply":
      return "No reply";
    case "closed":
      return "Closed";
  }
}

/**
 * How long something has been waiting, phrased for a list row.
 *
 * Returns null when there is no send time to describe, so callers render
 * nothing rather than "NaN days ago".
 */
export function waitingLabel(sentAt: string | Date | null | undefined, now: Date): string | null {
  const elapsed = elapsedDays(sentAt, now);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed === 0) return "today";
  if (elapsed === 1) return "1 day ago";
  return `${elapsed} days ago`;
}
