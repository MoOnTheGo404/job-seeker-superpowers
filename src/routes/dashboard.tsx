import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Win95Window, GroupBox } from "@/components/win95/Window";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { analyzeJob } from "@/lib/recruiters.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Your job targets — ReachPoint" },
      {
        name: "description",
        content:
          "Add a job posting and ReachPoint finds the recruiter or hiring manager behind it.",
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

  const count = targets.data?.length ?? 0;

  return (
    <div className="desktop-bg min-h-screen pb-[42px]" aria-busy={addTarget.isPending}>
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
        <Win95Window
          title="Add a job target"
          icon={<Plus className="size-3.5 text-black" />}
          status={[
            addTarget.isPending
              ? "Reading the posting…"
              : "Paste a link, or the description if the link needs a login.",
          ]}
          bodyClassName="bg-w95-face p-4"
        >
          <GroupBox label="Job posting" className="bg-w95-face">
            <div className="space-y-3">
              <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                <label htmlFor="url" className="text-[11px] text-black">
                  Posting link:
                </label>
                <Input
                  id="url"
                  placeholder="https://…"
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-start gap-2">
                <label htmlFor="desc" className="pt-1 text-[11px] text-black">
                  Description:
                </label>
                <Textarea
                  id="desc"
                  rows={4}
                  placeholder="Paste the posting text if the link is behind a login…"
                  value={jobText}
                  onChange={(e) => setJobText(e.target.value)}
                />
              </div>
            </div>
          </GroupBox>

          <div className="mt-3 flex justify-end">
            <Button
              className="min-w-[120px]"
              disabled={addTarget.isPending || (!jobUrl && !jobText)}
              onClick={() => addTarget.mutate()}
            >
              {addTarget.isPending ? "Reading…" : "Add target"}
            </Button>
          </div>
        </Win95Window>

        <Win95Window
          title="My Job Targets"
          icon={<FolderOpen className="size-3.5 text-black" />}
          menu={["File", "Edit", "View", "Help"]}
          status={[
            targets.isLoading ? "Loading…" : `${count} object${count === 1 ? "" : "s"}`,
            "ReachPoint",
          ]}
          bodyClassName="bg-w95-face p-1"
        >
          {/* Explorer "Details" view: sunken well, column headers, one row per item. */}
          <div className="bevel-in min-h-[220px] p-0">
            <div className="grid grid-cols-[1fr_1fr_120px_92px] gap-0 border-b border-b-w95-shadow bg-w95-face">
              {["Role", "Company", "Location", "Status"].map((h) => (
                <div
                  key={h}
                  className="bevel-out-thin truncate px-2 py-[3px] text-[11px] font-bold text-black"
                >
                  {h}
                </div>
              ))}
            </div>

            {targets.isLoading ? (
              <p className="px-2 py-2 text-[11px] text-black">Loading…</p>
            ) : count === 0 ? (
              <p className="px-2 py-2 text-[11px] text-black">
                This folder is empty. Add your first job target above.
              </p>
            ) : (
              <ul>
                {targets.data?.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/target/$id"
                      params={{ id: t.id }}
                      className="grid grid-cols-[1fr_1fr_120px_92px] items-center gap-0 px-0 py-[2px] text-[11px] text-black hover:bg-w95-title hover:text-white focus-visible:bg-w95-title focus-visible:text-white"
                    >
                      <span className="flex min-w-0 items-center gap-1 px-2">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{t.role_title}</span>
                      </span>
                      <span className="truncate px-2">{t.company}</span>
                      <span className="truncate px-2">{t.location ?? "—"}</span>
                      <span className="truncate px-2">{t.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Win95Window>
      </div>

      <AppHeader email={user?.email ?? null} />
    </div>
  );
}
