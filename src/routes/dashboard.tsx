import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { analyzeJob } from "@/lib/recruiters.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Your job targets — ReachPoint" },
      {
        name: "description",
        content: "Add a job posting and ReachPoint finds the recruiter or hiring manager behind it.",
      },
      { property: "og:title", content: "Your job targets — ReachPoint" },
      { property: "og:description", content: "Track applications and the people behind them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const analyze = useServerFn(analyzeJob);

  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const targets = useQuery({
    queryKey: ["targets", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_targets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const addTarget = useMutation({
    mutationFn: async () => {
      const payload: { jobUrl?: string; jobText?: string } = {};
      if (jobUrl) payload.jobUrl = jobUrl;
      if (jobText) payload.jobText = jobText;
      const analyzed = await analyze({ data: payload });
      const { data, error } = await supabase
        .from("job_targets")
        .insert({
          user_id: user!.id,
          company: analyzed.company,
          company_domain: analyzed.company_domain,
          role_title: analyzed.role_title || "Unknown role",
          location: analyzed.location,
          job_url: jobUrl || null,
          job_description: jobText || analyzed.summary,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      setJobUrl("");
      setJobText("");
      queryClient.invalidateQueries({ queryKey: ["targets"] });
      navigate({ to: "/target/$id", params: { id: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen">
      <AppHeader email={user?.email ?? null} />
      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-semibold">Job targets</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add a posting and we'll work out the company, then hunt down the people hiring for it.
        </p>

        <div className="surface-panel mt-6 rounded-2xl p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="url">Job posting link</Label>
              <Input
                id="url"
                placeholder="https://…"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Or paste the job description</Label>
              <Textarea
                id="desc"
                rows={3}
                placeholder="Paste the posting text if the link is behind a login…"
                value={jobText}
                onChange={(e) => setJobText(e.target.value)}
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={addTarget.isPending || (!jobUrl && !jobText)}
            onClick={() => addTarget.mutate()}
          >
            {addTarget.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {addTarget.isPending ? "Reading the posting…" : "Add job target"}
          </Button>
        </div>

        <div className="mt-10 space-y-3">
          {targets.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {targets.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No job targets yet. Add your first one above.</p>
          )}
          {targets.data?.map((t) => (
            <Link
              key={t.id}
              to="/target/$id"
              params={{ id: t.id }}
              className="surface-panel flex items-center justify-between rounded-xl p-5 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                  <Building2 className="size-4" />
                </span>
                <div>
                  <p className="font-medium">{t.role_title}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.company}
                    {t.location ? ` · ${t.location}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="secondary">{t.status}</Badge>
                <ArrowRight className="size-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
