/**
 * The morning queue: at most five concrete actions, in priority order.
 *
 * Pure, like outreach.status.ts — no network, no environment, no ambient clock.
 * `now` is always passed in, which is what makes the day boundaries testable
 * rather than hopeful.
 *
 * The cap is the feature. A dashboard that lists everything outstanding makes a
 * search feel like a backlog you are losing; five items with one button each
 * makes a morning feel finishable. Anything beyond the cap is counted, not
 * listed.
 */

import { elapsedDays, FOLLOW_UP_DAYS } from "./outreach.status";

/** Most items shown at once. Beyond this they are counted instead. */
export const QUEUE_LIMIT = 5;

/** Days without any drafted or sent message before a target looks stalled. */
export const IDLE_DAYS = 14;

/** The one job-target status that means "done, stop suggesting things". */
const TERMINAL_TARGET_STATUS = "closed";

export type QueueKind = "follow_up" | "first_message" | "no_contacts" | "idle_target";

export interface QueueAction {
  label: string;
  targetId: string;
  outreachId?: string;
}

export interface QueueItem {
  /** Stable across renders: the row the item is about. */
  id: string;
  kind: QueueKind;
  title: string;
  detail: string;
  action: QueueAction;
}

export interface QueueTarget {
  id: string;
  company: string;
  role_title: string;
  status: string;
  created_at: string;
}

export interface QueueContact {
  id: string;
  target_id: string;
  /**
   * Null on the placeholder rows discovery inserts when it finds nobody
   * ("Recruiting team", "No referrers found"). Since confirmedOnly now filters
   * before insert, a non-null link is exactly what distinguishes a real
   * confirmed person from a fallback card.
   */
  linkedin_url: string | null;
}

export interface QueueOutreach {
  id: string;
  contact_id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export interface QueueInput {
  targets: QueueTarget[];
  contacts: QueueContact[];
  outreach: QueueOutreach[];
}

export interface QueueResult {
  items: QueueItem[];
  /** Items that qualified but did not fit under the cap. */
  hiddenCount: number;
  /**
   * Sent messages still inside the reply window — not yet due for a follow-up.
   *
   * Computed from real rows so the empty state can say what is in flight. An
   * empty queue that invents a number is worse than one that says nothing.
   */
  awaitingReply: number;
}

/** A real, confirmed person rather than a "nobody found" placeholder. */
function isRealContact(c: QueueContact): boolean {
  return Boolean(c.linkedin_url);
}

/**
 * When something last happened on this target.
 *
 * Deliberately derived rather than read from job_targets.updated_at, which is
 * DEFAULT now() with no trigger and no writer anywhere in the app — a frozen
 * copy of created_at. Using it would report a target worked on yesterday as
 * neglected. Derived activity is retroactively correct on rows that already
 * exist, which a trigger added today could never be.
 */
export function lastActivityAt(target: QueueTarget, outreach: readonly QueueOutreach[]): string {
  let latest = target.created_at;
  for (const o of outreach) {
    const stamp = o.sent_at ?? o.created_at;
    if (stamp > latest) latest = stamp;
  }
  return latest;
}

/**
 * Build the queue.
 *
 * Sources are evaluated in priority order and a target contributes at most one
 * item, so a stalled target with an unanswered message appears once — as the
 * follow-up, which is the more actionable of the two.
 */
export function buildQueue(input: QueueInput, now: Date): QueueResult {
  const { targets, contacts, outreach } = input;

  const contactsByTarget = new Map<string, QueueContact[]>();
  for (const c of contacts) {
    const list = contactsByTarget.get(c.target_id) ?? [];
    list.push(c);
    contactsByTarget.set(c.target_id, list);
  }

  const targetIdByContact = new Map(contacts.map((c) => [c.id, c.target_id]));
  const outreachByTarget = new Map<string, QueueOutreach[]>();
  for (const o of outreach) {
    const targetId = targetIdByContact.get(o.contact_id);
    if (!targetId) continue;
    const list = outreachByTarget.get(targetId) ?? [];
    list.push(o);
    outreachByTarget.set(targetId, list);
  }

  const targetById = new Map(targets.map((t) => [t.id, t]));
  const candidates: QueueItem[] = [];
  const claimed = new Set<string>();

  const claim = (targetId: string, item: QueueItem) => {
    if (claimed.has(targetId)) return;
    claimed.add(targetId);
    candidates.push(item);
  };

  // 1. Sent, past the reply window, still unanswered.
  for (const o of outreach) {
    if (o.status !== "sent") continue;
    const days = elapsedDays(o.sent_at, now);
    if (days === null || days < FOLLOW_UP_DAYS) continue;
    const targetId = targetIdByContact.get(o.contact_id);
    if (!targetId) continue;
    const t = targetById.get(targetId);
    if (!t) continue;
    claim(targetId, {
      id: o.id,
      kind: "follow_up",
      title: `Follow up at ${t.company}`,
      detail: `Sent ${days} days ago, no reply yet · ${t.role_title}`,
      action: { label: "Draft follow-up", targetId, outreachId: o.id },
    });
  }

  // 2. Real contacts found, nothing written to any of them.
  for (const t of targets) {
    if (t.status === TERMINAL_TARGET_STATUS) continue;
    const real = (contactsByTarget.get(t.id) ?? []).filter(isRealContact);
    if (!real.length) continue;
    if ((outreachByTarget.get(t.id) ?? []).length > 0) continue;
    claim(t.id, {
      id: t.id,
      kind: "first_message",
      title: `Write to ${t.company}`,
      detail: `${real.length} contact${real.length === 1 ? "" : "s"} found, none messaged · ${t.role_title}`,
      action: { label: "Draft first message", targetId: t.id },
    });
  }

  // 3. Nobody confirmed at the company at all.
  for (const t of targets) {
    if (t.status === TERMINAL_TARGET_STATUS) continue;
    const real = (contactsByTarget.get(t.id) ?? []).filter(isRealContact);
    if (real.length) continue;
    claim(t.id, {
      id: t.id,
      kind: "no_contacts",
      title: `No confirmed contacts at ${t.company}`,
      detail: `Search LinkedIn directly · ${t.role_title}`,
      action: { label: "Open people search", targetId: t.id },
    });
  }

  // 4. Nothing has happened here for a fortnight.
  for (const t of targets) {
    if (t.status === TERMINAL_TARGET_STATUS) continue;
    const idle = elapsedDays(lastActivityAt(t, outreachByTarget.get(t.id) ?? []), now);
    if (idle === null || idle < IDLE_DAYS) continue;
    claim(t.id, {
      id: t.id,
      kind: "idle_target",
      title: `${t.company} has gone quiet`,
      detail: `No activity for ${idle} days · still ${t.status}`,
      action: { label: "Close or reopen", targetId: t.id },
    });
  }

  // Sent and still inside the window — real rows, for the empty state.
  const awaitingReply = outreach.filter((o) => {
    if (o.status !== "sent") return false;
    const days = elapsedDays(o.sent_at, now);
    return days !== null && days >= 0 && days < FOLLOW_UP_DAYS;
  }).length;

  return {
    items: candidates.slice(0, QUEUE_LIMIT),
    hiddenCount: Math.max(0, candidates.length - QUEUE_LIMIT),
    awaitingReply,
  };
}

/**
 * What to say when the queue is empty.
 *
 * Only mentions a number when there is one to mention. "Nothing due" plus an
 * invented count would be a small lie told first thing in the morning, on the
 * one surface meant to be trusted.
 */
export function emptyQueueMessage(awaitingReply: number): string {
  if (awaitingReply === 1) {
    return "Nothing due today. 1 message is still within the reply window.";
  }
  if (awaitingReply > 1) {
    return `Nothing due today. ${awaitingReply} messages are still within the reply window.`;
  }
  return "Nothing due today. Add a job target to get started.";
}
