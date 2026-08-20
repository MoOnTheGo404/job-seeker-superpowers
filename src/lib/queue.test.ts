import { describe, expect, it } from "vitest";
import {
  buildQueue,
  emptyQueueMessage,
  IDLE_DAYS,
  lastActivityAt,
  QUEUE_LIMIT,
  type QueueContact,
  type QueueInput,
  type QueueOutreach,
  type QueueTarget,
} from "./queue";
import { FOLLOW_UP_DAYS } from "./outreach.status";

const NOW = new Date("2026-08-20T12:00:00Z");
const ago = (days: number, hours = 0) =>
  new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000).toISOString();

const target = (over: Partial<QueueTarget> = {}): QueueTarget => ({
  id: "t1",
  company: "Acme",
  role_title: "Backend Engineer",
  status: "researching",
  created_at: ago(1),
  ...over,
});
const contact = (over: Partial<QueueContact> = {}): QueueContact => ({
  id: "c1",
  target_id: "t1",
  linkedin_url: "https://linkedin.com/in/someone",
  ...over,
});
const sent = (over: Partial<QueueOutreach> = {}): QueueOutreach => ({
  id: "o1",
  contact_id: "c1",
  status: "sent",
  sent_at: ago(FOLLOW_UP_DAYS),
  created_at: ago(FOLLOW_UP_DAYS),
  ...over,
});
const input = (over: Partial<QueueInput> = {}): QueueInput => ({
  targets: [],
  contacts: [],
  outreach: [],
  ...over,
});

describe("source 1 — unanswered messages past the reply window", () => {
  it("queues a sent message that has gone quiet", () => {
    const q = buildQueue(
      input({ targets: [target()], contacts: [contact()], outreach: [sent()] }),
      NOW,
    );
    expect(q.items).toHaveLength(1);
    expect(q.items[0]!.kind).toBe("follow_up");
    expect(q.items[0]!.action.outreachId).toBe("o1");
  });

  it("leaves a message still inside the window alone", () => {
    const q = buildQueue(
      input({
        targets: [target()],
        contacts: [contact()],
        outreach: [sent({ sent_at: ago(FOLLOW_UP_DAYS - 1) })],
      }),
      NOW,
    );
    expect(q.items.filter((i) => i.kind === "follow_up")).toHaveLength(0);
  });

  it("ignores messages that already resolved", () => {
    for (const status of ["replied", "no_reply", "closed", "drafted"]) {
      const q = buildQueue(
        input({ targets: [target()], contacts: [contact()], outreach: [sent({ status })] }),
        NOW,
      );
      expect(q.items.filter((i) => i.kind === "follow_up")).toHaveLength(0);
    }
  });
});

describe("source 2 — contacts found, nothing written", () => {
  it("queues a target whose contacts have never been messaged", () => {
    const q = buildQueue(input({ targets: [target()], contacts: [contact()] }), NOW);
    expect(q.items[0]!.kind).toBe("first_message");
    expect(q.items[0]!.detail).toContain("1 contact");
  });

  it("does not queue one that already has outreach", () => {
    const q = buildQueue(
      input({
        targets: [target()],
        contacts: [contact()],
        outreach: [sent({ status: "drafted", sent_at: null })],
      }),
      NOW,
    );
    expect(q.items.filter((i) => i.kind === "first_message")).toHaveLength(0);
  });

  it("does not count a fallback placeholder as a contact", () => {
    // Discovery inserts a "Recruiting team" row with no LinkedIn URL when it
    // confirms nobody. Treating that as a contact would tell the user to write
    // to a card that names no one.
    const q = buildQueue(
      input({ targets: [target()], contacts: [contact({ linkedin_url: null })] }),
      NOW,
    );
    expect(q.items[0]!.kind).toBe("no_contacts");
  });
});

describe("source 3 — nobody confirmed at the company", () => {
  it("queues a target with no real contacts", () => {
    const q = buildQueue(input({ targets: [target()] }), NOW);
    expect(q.items[0]!.kind).toBe("no_contacts");
    expect(q.items[0]!.action.label).toBe("Open people search");
  });
});

describe("source 4 — idle targets", () => {
  it("queues a target with no activity for the idle window", () => {
    const q = buildQueue(input({ targets: [target({ created_at: ago(IDLE_DAYS) })] }), NOW);
    // Also has no contacts, and source 3 outranks source 4.
    expect(q.items[0]!.kind).toBe("no_contacts");

    const withContacts = buildQueue(
      input({
        targets: [target({ created_at: ago(IDLE_DAYS) })],
        contacts: [contact()],
        outreach: [
          sent({ status: "replied", sent_at: ago(IDLE_DAYS), created_at: ago(IDLE_DAYS) }),
        ],
      }),
      NOW,
    );
    expect(withContacts.items[0]!.kind).toBe("idle_target");
  });

  it("is not idle one hour short of the boundary", () => {
    const q = buildQueue(
      input({
        targets: [target({ created_at: ago(IDLE_DAYS - 1, 23) })],
        contacts: [contact()],
        outreach: [
          sent({
            status: "replied",
            sent_at: ago(IDLE_DAYS - 1, 23),
            created_at: ago(IDLE_DAYS - 1, 23),
          }),
        ],
      }),
      NOW,
    );
    expect(q.items.filter((i) => i.kind === "idle_target")).toHaveLength(0);
  });

  it("never queues a closed target", () => {
    const q = buildQueue(
      input({ targets: [target({ status: "closed", created_at: ago(90) })] }),
      NOW,
    );
    expect(q.items).toEqual([]);
  });
});

describe("priority and the cap", () => {
  it("gives a target one item, not one per qualifying source", () => {
    // Old, has contacts, has an unanswered message: qualifies for 1 and 4.
    const q = buildQueue(
      input({
        targets: [target({ created_at: ago(60) })],
        contacts: [contact()],
        outreach: [sent({ sent_at: ago(30), created_at: ago(30) })],
      }),
      NOW,
    );
    expect(q.items).toHaveLength(1);
    expect(q.items[0]!.kind).toBe("follow_up");
  });

  it("orders follow-ups ahead of everything else", () => {
    const q = buildQueue(
      input({
        targets: [target({ id: "t1" }), target({ id: "t2", company: "Beta" })],
        contacts: [contact({ id: "c1", target_id: "t1" })],
        outreach: [sent({ contact_id: "c1" })],
      }),
      NOW,
    );
    expect(q.items[0]!.kind).toBe("follow_up");
    expect(q.items[1]!.kind).toBe("no_contacts");
  });

  it("caps at five and counts the rest", () => {
    const targets = Array.from({ length: 9 }, (_, i) => target({ id: `t${i}`, company: `Co${i}` }));
    const q = buildQueue(input({ targets }), NOW);
    expect(q.items).toHaveLength(QUEUE_LIMIT);
    expect(q.hiddenCount).toBe(4);
  });

  it("reports no overflow when everything fits", () => {
    const q = buildQueue(input({ targets: [target()] }), NOW);
    expect(q.hiddenCount).toBe(0);
  });
});

describe("lastActivityAt", () => {
  it("uses the target's own creation when nothing else happened", () => {
    const t = target({ created_at: ago(5) });
    expect(lastActivityAt(t, [])).toBe(t.created_at);
  });

  it("prefers the most recent message over the target's creation", () => {
    const t = target({ created_at: ago(30) });
    const recent = sent({ sent_at: ago(2), created_at: ago(3) });
    expect(lastActivityAt(t, [recent])).toBe(recent.sent_at);
  });

  it("falls back to a draft's creation when it was never sent", () => {
    const t = target({ created_at: ago(30) });
    const draft = sent({ status: "drafted", sent_at: null, created_at: ago(2) });
    expect(lastActivityAt(t, [draft])).toBe(draft.created_at);
  });
});

describe("empty state", () => {
  it("counts only messages genuinely awaiting a reply", () => {
    const q = buildQueue(
      input({
        targets: [target({ status: "closed" })],
        contacts: [contact()],
        outreach: [
          sent({ id: "a", sent_at: ago(1) }),
          sent({ id: "b", sent_at: ago(2) }),
          sent({ id: "c", status: "replied", sent_at: ago(3) }),
          sent({ id: "d", status: "drafted", sent_at: null }),
        ],
      }),
      NOW,
    );
    expect(q.items).toEqual([]);
    expect(q.awaitingReply).toBe(2);
  });

  it("says nothing about a number it does not have", () => {
    // The count must come from real rows. Inventing one on the surface meant
    // to be trusted first thing in the morning is worse than a blank panel.
    expect(emptyQueueMessage(0)).toBe("Nothing due today. Add a job target to get started.");
    expect(emptyQueueMessage(0)).not.toMatch(/\d+ messages?/);
  });

  it("uses singular and plural correctly when it does have one", () => {
    expect(emptyQueueMessage(1)).toContain("1 message is still");
    expect(emptyQueueMessage(3)).toContain("3 messages are still");
  });

  it("returns an empty queue for an empty account", () => {
    const q = buildQueue(input(), NOW);
    expect(q).toEqual({ items: [], hiddenCount: 0, awaitingReply: 0 });
  });
});
