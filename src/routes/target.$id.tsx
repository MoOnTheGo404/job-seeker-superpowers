import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { discoverContacts, draftOutreach } from "@/lib/recruiters.functions";

export const Route = createFileRoute("/target/$id")({
  head: () => ({
    meta: [
      { title: "Recruiter contacts — ReachPoint" },
      {
        name: "description",
        content: "Recruiters, hiring managers, LinkedIn profiles and verified public emails for this application.",
      },
      { property: "og:title", content: "Recruiter contacts — ReachPoint" },
      { property: "og:description", content: "Every email comes with the public page it was found on." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TargetPage,
});

const STATUSES = ["researching", "contacted", "applied", "interviewing", "closed"];

function TargetPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runDiscovery = useServerFn(discoverContacts);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const target = useQuery({
    queryKey: ["target", id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from("job_targets").select("*").eq("id", id).maybeSingle();
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

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("job_targets").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["target", id] }),
  });

  return (
    <div className="min-h-screen">
      <AppHeader email={user?.email ?? null} />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All job targets
        </Link>

        {target.data && (
          <div className="surface-panel mt-5 rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">{target.data.role_title}</h1>
                <p className="mt-1 text-muted-foreground">
                  {target.data.company}
                  {target.data.location ? ` · ${target.data.location}` : ""}
                  {target.data.company_domain ? ` · ${target.data.company_domain}` : ""}
                </p>
                {target.data.job_url && (
                  <a
                    href={target.data.job_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    Original posting <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Select value={target.data.status} onValueChange={(v) => setStatus.mutate(v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => discover.mutate()} disabled={discover.isPending}>
                  {discover.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
                  {discover.isPending ? "Searching the web…" : "Find recruiters"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">Contacts</h2>
          {discover.isPending && (
            <p className="text-sm text-muted-foreground">
              Searching public sources for recruiters, hiring managers and published emails. This can take up to a
              minute.
            </p>
          )}
          {!discover.isPending && contacts.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No contacts yet — hit “Find recruiters” to search public sources.
            </p>
          )}
          {contacts.data?.map((c) => <ContactCard key={c.id} contact={c} />)}
        </section>
      </main>
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
}

function ContactCard({ contact }: { contact: ContactRow }) {
  const draft = useServerFn(draftOutreach);
  const [channel, setChannel] = useState<"email" | "linkedin">(contact.email ? "email" : "linkedin");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: async () => draft({ data: { contactId: contact.id, channel } }),
    onSuccess: (row) => {
      setMessage(row.message);
      setSubject(row.subject);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <article className="surface-panel rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">{contact.name ?? "Recruiting team"}</h3>
          {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
        </div>
        {contact.email_status === "verified_public" && (
          <Badge className="bg-success text-success-foreground">
            <ShieldCheck className="size-3.5" /> Public email found
          </Badge>
        )}
        {contact.email_status === "team_inbox" && <Badge variant="secondary">Company inbox</Badge>}
        {contact.email_status === "not_found" && <Badge variant="outline">LinkedIn only</Badge>}
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        {contact.email ? (
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-4 text-primary" />
            <a href={`mailto:${contact.email}`} className="font-medium hover:underline">
              {contact.email}
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(contact.email!);
                toast.success("Email copied");
              }}
            >
              <Copy className="size-3.5" />
            </Button>
            {contact.email_source_url && (
              <a
                href={contact.email_source_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                source
              </a>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            No publicly published email — we never guess addresses. Use LinkedIn below.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              <Linkedin className="size-4" /> LinkedIn profile
            </a>
          )}
          {contact.linkedin_search_url && (
            <a
              href={contact.linkedin_search_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" /> Search on LinkedIn
            </a>
          )}
        </div>

        {contact.notes && <p className="text-xs text-muted-foreground">{contact.notes}</p>}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={channel} onValueChange={(v) => setChannel(v as "email" | "linkedin")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email" disabled={!contact.email}>
                Email
              </SelectItem>
              <SelectItem value="linkedin">LinkedIn note</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Draft message
          </Button>
        </div>

        {message && (
          <div className="mt-4 space-y-2">
            {subject && <p className="text-sm font-medium">Subject: {subject}</p>}
            <Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(message);
                  toast.success("Message copied");
                }}
              >
                <Copy className="size-3.5" /> Copy
              </Button>
              {channel === "email" && contact.email && (
                <Button asChild size="sm">
                  <a
                    href={`mailto:${contact.email}?subject=${encodeURIComponent(subject ?? "")}&body=${encodeURIComponent(message)}`}
                  >
                    <Mail className="size-3.5" /> Open in mail app
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
