import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Linkedin,
  Mail,
  Radar,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Win95Window, GroupBox } from "@/components/win95/Window";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  closeOutreachForTarget,
  deleteJobTarget,
  discoverContacts,
  discoverReferrers,
  draftOutreach,
  updateOutreachStatus,
} from "@/lib/recruiters.functions";
import type { OutreachStatus } from "@/lib/outreach.status";
import { linkedInAlumniSearchUrl, parseSchools } from "@/lib/discovery.parse";

export const Route = createFileRoute("/target/$id")({
  head: () => ({
    meta: [
      { title: "Recruiter contacts — ReachPoint" },
      {
        name: "description",
        content:
          "Recruiters, hiring managers, LinkedIn profiles and verified public emails for this application.",
      },
      { property: "og:title", content: "Recruiter contacts — ReachPoint" },
      {
        property: "og:description",
        content: "Every email comes with the public page it was found on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TargetPage,
});

const STATUSES = ["researching", "contacted", "applied", "interviewing", "closed"];

const BACKGROUND_KEY = "reachpoint:applicant-background";
const SCHOOLS_KEY = "reachpoint:applicant-schools";

/**
 * The applicant's own background, the only facts a draft is allowed to state
 * about them.
 *
 * Kept in localStorage rather than the profiles table so it carries across
 * every target without a migration. Worth moving server-side later if it
 * should follow the user between devices.
 */
function useApplicantBackground() {
  return useLocalField(BACKGROUND_KEY);
}

/**
 * The applicant's schools, one per line.
 *
 * Stored separately from the free-text background rather than parsed out of
 * it: guessing which words in a sentence are an institution is exactly the
 * kind of inference that produces confident wrong answers. Same localStorage
 * dependency as the background, and it moves server-side with it.
 */
function useApplicantSchools() {
  return useLocalField(SCHOOLS_KEY);
}

function useLocalField(key: string) {
  const [value, setValue] = useState("");
  const hydrated = useRef(false);

  // Read after mount: localStorage does not exist during SSR, so seeding
  // useState from it directly would desync the server and client renders.
  useEffect(() => {
    setValue(localStorage.getItem(key) ?? "");
    hydrated.current = true;
  }, [key]);

  useEffect(() => {
    // Guarded so the pre-hydration empty string can't wipe a stored value.
    if (hydrated.current) localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}

/** Win95 combo box: sunken field plus a beveled drop-down arrow on the right. */
function W95Select({
  value,
  onChange,
  children,
  className,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={`bevel-in relative inline-flex items-center ${className ?? ""}`}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-transparent py-[2px] pr-6 pl-[4px] text-[11px] text-black focus:outline-none"
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="bevel-out pointer-events-none absolute top-[2px] right-[2px] bottom-[2px] grid w-[16px] place-items-center text-[8px] leading-none text-black"
      >
        ▼
      </span>
    </div>
  );
}

function TargetPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runDiscovery = useServerFn(discoverContacts);
  const runReferrerDiscovery = useServerFn(discoverReferrers);
  const [background, setBackground] = useApplicantBackground();
  const [schools, setSchools] = useApplicantSchools();
  const schoolList = useMemo(() => parseSchools(schools), [schools]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const target = useQuery({
    queryKey: ["target", id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_targets")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const contacts = useQuery({
    queryKey: ["contacts", id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("target_id", id)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const discover = useMutation({
    mutationFn: async () => runDiscovery({ data: { targetId: id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", id] });
      toast.success("Search finished.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const findReferrers = useMutation({
    mutationFn: async () => runReferrerDiscovery({ data: { targetId: id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", id] });
      toast.success("Referral search finished.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("job_targets").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["target", id] }),
  });

  // Both kinds live in one table; split them here so each gets its own list,
  // its own empty state and its own message purpose.
  const all = contacts.data ?? [];
  const recruiters = all.filter((c) => c.contact_type !== "referrer");
  const referrers = all.filter((c) => c.contact_type === "referrer");
  const busy = discover.isPending || findReferrers.isPending;

  return (
    <div className="desktop-bg min-h-screen pb-[42px]" aria-busy={busy}>
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-[11px] text-[#0000ee] underline hover:text-[#551a8b]"
        >
          <ArrowLeft className="size-3.5" /> All job targets
        </Link>

        {target.data && (
          <Win95Window
            title={`${target.data.role_title} — ${target.data.company}`}
            icon={<Radar className="size-3.5 text-black" />}
            menu={["File", "Edit", "View", "Help"]}
            status={[
              target.data.company_domain ?? "No company domain",
              `Status: ${target.data.status}`,
            ]}
            bodyClassName="bg-w95-face p-4"
          >
            <GroupBox label="Application" className="bg-w95-face">
              <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[11px] text-black">
                <dt className="font-bold">Role:</dt>
                <dd>{target.data.role_title}</dd>
                <dt className="font-bold">Company:</dt>
                <dd>{target.data.company}</dd>
                <dt className="font-bold">Location:</dt>
                <dd>{target.data.location ?? "—"}</dd>
                <dt className="font-bold">Domain:</dt>
                <dd>{target.data.company_domain ?? "—"}</dd>
                {target.data.job_url ? (
                  <>
                    <dt className="font-bold">Posting:</dt>
                    <dd>
                      <a
                        href={target.data.job_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#0000ee] underline hover:text-[#551a8b]"
                      >
                        Original posting <ExternalLink className="size-3" />
                      </a>
                    </dd>
                  </>
                ) : null}
              </dl>
            </GroupBox>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor="status" className="text-[11px] text-black">
                  Status:
                </label>
                <W95Select
                  id="status"
                  value={target.data.status}
                  onChange={(v) => setStatus.mutate(v)}
                  className="w-[140px]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </W95Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => discover.mutate()}
                  disabled={discover.isPending}
                  className="min-w-[130px]"
                >
                  {discover.isPending ? "Searching…" : "Find recruiters"}
                </Button>
                <Button
                  onClick={() => findReferrers.mutate()}
                  disabled={findReferrers.isPending}
                  className="min-w-[150px]"
                >
                  {findReferrers.isPending ? "Searching…" : "Find referrers"}
                </Button>
              </div>
            </div>
          </Win95Window>
        )}

        <Win95Window
          title="Contacts"
          icon={<Users className="size-3.5 text-black" />}
          status={[
            busy
              ? "Searching public sources… this can take up to a minute."
              : `${recruiters.length} recruiter${recruiters.length === 1 ? "" : "s"}, ${referrers.length} referrer${referrers.length === 1 ? "" : "s"}`,
            "Sources shown for every email",
          ]}
          bodyClassName="bg-w95-face p-4"
        >
          <div className="space-y-3">
            <GroupBox label="About you" className="bg-w95-face">
              <p className="mb-2 text-[11px] text-black">
                The drafts can only state what you put here. Leave it empty and every personal
                detail comes back as a <span className="font-mono">[bracketed blank]</span> for you
                to fill in — the model is instructed never to invent your background.
              </p>
              <Textarea
                id="applicant-background"
                rows={4}
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                placeholder="e.g. 4 years backend Go at a fintech; led the payments migration; graduating MSc CS June 2026…"
              />

              <label
                htmlFor="applicant-schools"
                className="mt-3 mb-1 block text-[11px] font-bold text-black"
              >
                Your schools — one per line
              </label>
              <p className="mb-2 text-[11px] text-black">
                Used only to build alumni search links below. Add abbreviations as their own line if
                you use them, for example “UCSD” under “University of California, San Diego” — they
                are never guessed for you.
              </p>
              <Textarea
                id="applicant-schools"
                rows={3}
                value={schools}
                onChange={(e) => setSchools(e.target.value)}
                placeholder={"University of California, San Diego\nUCSD"}
              />
            </GroupBox>

            {schoolList.length > 0 && target.data?.company && (
              <GroupBox label="Alumni search" className="bg-w95-face">
                <p className="mb-2 text-[11px] text-black">
                  A shared school is the strongest opener you have. These open LinkedIn people
                  search for {target.data.company}, filtered by each school you listed — one link
                  per school, because LinkedIn handles a single term far more reliably.
                </p>
                <ul className="space-y-1">
                  {schoolList.map((school) => {
                    const company = target.data?.company ?? "";
                    return (
                      <li key={school}>
                        <a
                          className="text-[11px] text-w95-title underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted"
                          href={linkedInAlumniSearchUrl(company, school)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {company} alumni from {school}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </GroupBox>
            )}

            {busy && (
              <div className="bevel-in-thin bg-w95-info px-3 py-2 text-[11px] text-black">
                Searching public sources. This can take up to a minute.
              </div>
            )}

            <ContactSection
              heading="Recruiters &amp; hiring managers"
              hint="People whose job is to receive applications."
              emptyHint="None yet — choose “Find recruiters”."
              contacts={recruiters}
              background={background}
              purpose="application"
            />

            <ContactSection
              heading="Potential referrers"
              hint="Senior people on the hiring team. A referral from here carries more weight than a cold application — but it is a favour, so ask on LinkedIn and only where you have a real reason."
              emptyHint="None yet — choose “Find referrers”."
              contacts={referrers}
              background={background}
              purpose="referral"
            />
          </div>
        </Win95Window>
      </div>

      <AppHeader email={user?.email ?? null} />
    </div>
  );
}

interface ContactRow {
  id: string;
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  linkedin_search_url: string | null;
  email: string | null;
  email_source_url: string | null;
  email_status: string;
  notes: string | null;
  contact_type?: string;
}

function ContactSection({
  heading,
  hint,
  emptyHint,
  contacts,
  background,
  purpose,
}: {
  heading: string;
  hint: string;
  emptyHint: string;
  contacts: ContactRow[];
  background: string;
  purpose: "application" | "referral";
}) {
  return (
    <section>
      <h2 className="text-[12px] font-bold text-black">{heading}</h2>
      <p className="mt-1 mb-2 max-w-[70ch] text-[11px] text-w95-muted-text">{hint}</p>
      {contacts.length === 0 ? (
        <div className="bevel-in-thin bg-w95-info px-3 py-2 text-[11px] text-black">
          {emptyHint}
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map((c) => (
            <ContactCard key={c.id} contact={c} background={background} purpose={purpose} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContactCard({
  contact,
  background,
  purpose,
}: {
  contact: ContactRow;
  background: string;
  purpose: "application" | "referral";
}) {
  const draft = useServerFn(draftOutreach);
  const setStatus = useServerFn(updateOutreachStatus);
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<"email" | "linkedin">(
    contact.email ? "email" : "linkedin",
  );
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  // The row id was previously discarded, which left nothing to mark as sent.
  const [outreachId, setOutreachId] = useState<string | null>(null);
  const [status, setStatusLocal] = useState<OutreachStatus>("drafted");

  const generate = useMutation({
    mutationFn: async () =>
      draft({
        data: {
          contactId: contact.id,
          channel,
          purpose,
          // Omitted entirely when blank, so the server prompt takes its
          // "nothing is known about this applicant" branch.
          ...(background.trim() ? { extra: background.trim() } : {}),
        },
      }),
    onSuccess: (row) => {
      setMessage(row.message);
      setSubject(row.subject);
      setOutreachId(row.id);
      setStatusLocal("drafted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async (next: OutreachStatus) => {
      if (!outreachId) return null;
      return setStatus({ data: { outreachId, status: next } });
    },
    onSuccess: (row) => {
      if (!row) return;
      setStatusLocal(row.status as OutreachStatus);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Copying a draft is sending it. Nobody copies a message they do not intend
   * to use, and asking them to also flip a dropdown afterwards is the step
   * people skip — after which the tracker is wrong and they stop trusting it.
   * Undo covers the case where they were only re-reading.
   */
  function markSent() {
    if (!outreachId || status !== "drafted") return;
    move.mutate("sent", {
      onSuccess: () =>
        toast.success("Marked as sent", {
          action: { label: "Undo", onClick: () => move.mutate("drafted") },
          duration: 6000,
        }),
    });
  }

  return (
    <GroupBox label={contact.name ?? "Recruiting team"} className="bg-w95-face">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {contact.title ? <p className="text-[11px] text-black">{contact.title}</p> : <span />}
        {contact.email_status === "verified_public" && (
          <Badge className="gap-1">
            <ShieldCheck className="size-3" /> Public email found
          </Badge>
        )}
        {contact.email_status === "team_inbox" && <Badge variant="secondary">Company inbox</Badge>}
        {contact.email_status === "not_found" && <Badge variant="outline">LinkedIn only</Badge>}
      </div>

      <div className="mt-2 grid gap-1 text-[11px]">
        {contact.email ? (
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-3.5 text-black" />
            <a
              href={`mailto:${contact.email}`}
              className="text-[#0000ee] underline hover:text-[#551a8b]"
            >
              {contact.email}
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(contact.email!);
                toast.success("Email copied");
              }}
            >
              <Copy className="size-3" /> Copy
            </Button>
            {contact.email_source_url && (
              <a
                href={contact.email_source_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#0000ee] underline hover:text-[#551a8b]"
              >
                source
              </a>
            )}
          </div>
        ) : (
          <p className="text-black">
            No publicly published email — we never guess addresses. Use LinkedIn below.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#0000ee] underline hover:text-[#551a8b]"
            >
              <Linkedin className="size-3.5" /> LinkedIn profile
            </a>
          )}
          {contact.linkedin_search_url && (
            <a
              href={contact.linkedin_search_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#0000ee] underline hover:text-[#551a8b]"
            >
              <ExternalLink className="size-3" /> Search on LinkedIn
            </a>
          )}
        </div>

        {contact.notes && <p className="text-w95-muted-text">{contact.notes}</p>}
      </div>

      <div className="mt-3 border-t border-t-w95-shadow pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`ch-${contact.id}`} className="text-[11px] text-black">
            Send via:
          </label>
          <W95Select
            id={`ch-${contact.id}`}
            value={channel}
            onChange={(v) => setChannel(v as "email" | "linkedin")}
            className="w-[130px]"
          >
            <option value="email" disabled={!contact.email}>
              Email
            </option>
            <option value="linkedin">LinkedIn note</option>
          </W95Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? "Writing…" : "Draft message"}
          </Button>
        </div>

        {message && (
          <div className="mt-3 space-y-2">
            {subject && (
              <p className="text-[11px] text-black">
                <span className="font-bold">Subject:</span> {subject}
              </p>
            )}
            <Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(message);
                  markSent();
                }}
              >
                <Copy className="size-3" /> Copy
              </Button>
              {channel === "email" && contact.email && (
                <Button asChild size="sm">
                  <a
                    href={`mailto:${contact.email}?subject=${encodeURIComponent(subject ?? "")}&body=${encodeURIComponent(message)}`}
                    onClick={markSent}
                  >
                    <Mail className="size-3" /> Open in mail app
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </GroupBox>
  );
}
