import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, FileText, FolderOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Win95Window, GroupBox } from "@/components/win95/Window";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLegacyProfileMigration } from "@/hooks/useProfile";
import { analyzeJob, deleteJobTarget, updateOutreachStatus } from "@/lib/recruiters.functions";
import { buildQueue, emptyQueueMessage } from "@/lib/queue";

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

  /*
   * One-time move of the old browser-stored background into the profile. Runs
   * here rather than on the profile page so it happens on the surface everyone
   * lands on. Safe to run repeatedly: local data is only ever promoted into an
   * empty server profile, so a second device or a reload mid-migration clears
   * rather than overwrites.
   */
  useLegacyProfileMigration(user?.id);
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

  /*
   * The three row sets the queue is built from. Read directly under RLS, the
   * same way targets already are; only the writes go through server functions.
   *
   * One query object, not three, so the queue has a single loading state and a
   * single error state. Partial data would let a failed join render as a
   * shorter queue rather than as a failure.
   */
  const queueData = useQuery({
    queryKey: ["queue", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [t, c, o] = await Promise.all([
        supabase.from("job_targets").select("id, company, role_title, status, created_at"),
        supabase.from("contacts").select("id, target_id, linkedin_url"),
        supabase.from("outreach").select("id, contact_id, status, sent_at, created_at"),
      ]);
      const failure = t.error ?? c.error ?? o.error;
      if (failure) throw new Error(failure.message);
      return {
        targets: t.data ?? [],
        contacts: c.data ?? [],
        outreach: o.data ?? [],
      };
    },
  });

  const now = new Date();
  /*
   * Only built from data that actually arrived. While loading or after a
   * failure this stays empty, and the panel below renders those as their own
   * states — never as "nothing due", which would be a false all-clear on the
   * first surface of the day.
   */
  const queue = queueData.data
    ? buildQueue(queueData.data, now)
    : { items: [], hiddenCount: 0, awaitingReply: 0 };

  const moveStatus = useServerFn(updateOutreachStatus);
  const resolve = useMutation({
    mutationFn: async (vars: { outreachId: string; status: "replied" | "no_reply" }) =>
      moveStatus({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Closing a target from the queue writes the same column the target view's
   * status dropdown writes, under the same RLS. No new server function for
   * something the app already does.
   */
  const closeTarget = useMutation({
    mutationFn: async (targetId: string) => {
      const { error } = await supabase
        .from("job_targets")
        .update({ status: "closed" })
        .eq("id", targetId);
      if (error) throw new Error(error.message);
      return targetId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["targets"] });
      toast.success("Target closed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTarget = useServerFn(deleteJobTarget);
  const destroy = useMutation({
    mutationFn: async (targetId: string) => removeTarget({ data: { targetId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      toast.success("Job target deleted");
    },
    onError: (e: Error) => toast.error(e.message),
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
          department: analyzed.department,
          seniority: analyzed.seniority,
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

        {/*
          The first surface of the day, so its three states are kept distinct.
          A failed query must never look like an empty queue: one is "something
          is broken", the other is "you are on top of things", and rendering
          the first as the second is a false all-clear.
        */}
        <Win95Window
          title="Today"
          icon={<Clock className="size-3.5 text-black" />}
          menu={["File", "Edit", "View", "Help"]}
          status={[
            queueData.isLoading
              ? "Loading…"
              : queueData.isError
                ? "Couldn't load"
                : queue.items.length
                  ? `${queue.items.length} to do${queue.hiddenCount ? ` · ${queue.hiddenCount} more` : ""}`
                  : "Nothing due",
            "ReachPoint",
          ]}
          bodyClassName="bg-w95-face p-2"
        >
          {queueData.isLoading ? (
            <p className="px-1 py-2 text-[11px] text-black">Loading your queue…</p>
          ) : queueData.isError ? (
            <div className="bevel-in-thin bg-w95-info px-3 py-2 text-[11px] text-black">
              <p className="font-bold">Couldn&apos;t load your queue.</p>
              <p className="mt-1">
                {queueData.error instanceof Error ? queueData.error.message : "Unknown error."}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void queueData.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : queue.items.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-black">
              {emptyQueueMessage(queue.awaitingReply)}
            </p>
          ) : (
            <>
              <ul className="bevel-in divide-y divide-w95-shadow bg-w95-field">
                {queue.items.map((item) => (
                  <li
                    key={`${item.kind}:${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-black">{item.title}</p>
                      <p className="truncate text-[11px] text-w95-muted">{item.detail}</p>
                    </div>
                    {/* One button, inline. No modal, no navigating away. */}
                    <div className="flex shrink-0 gap-1">
                      {/*
                        Follow-up rows carry a second button on purpose.
                        Recording a reply is the one transition the design
                        never infers from an action, and this window was the
                        only place in the app that could do it — dropping it
                        would make "replied" unreachable and leave reply-rate
                        data permanently empty.
                      */}
                      {item.kind === "follow_up" && item.action.outreachId && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={resolve.isPending}
                          onClick={() =>
                            resolve.mutate({
                              outreachId: item.action.outreachId!,
                              status: "replied",
                            })
                          }
                        >
                          Replied
                        </Button>
                      )}
                      {item.kind === "idle_target" ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={closeTarget.isPending}
                            onClick={() => closeTarget.mutate(item.action.targetId)}
                          >
                            Mark closed
                          </Button>
                          <Button size="sm" asChild>
                            <Link to="/target/$id" params={{ id: item.action.targetId }}>
                              Reopen
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" asChild>
                          <Link to="/target/$id" params={{ id: item.action.targetId }}>
                            {item.action.label}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {queue.hiddenCount > 0 && (
                <p className="px-1 pt-2 text-[11px] text-w95-muted">and {queue.hiddenCount} more</p>
              )}
            </>
          )}
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
            <div className="flex border-b border-b-w95-shadow bg-w95-face">
              <div className="grid flex-1 grid-cols-[1fr_1fr_120px_92px] gap-0">
                {["Role", "Company", "Location", "Status"].map((h) => (
                  <div
                    key={h}
                    className="bevel-out-thin truncate px-2 py-[3px] text-[11px] font-bold text-black"
                  >
                    {h}
                  </div>
                ))}
              </div>
              {/* Lines up with the per-row delete button below. */}
              <div className="bevel-out-thin w-7 shrink-0 py-[3px]" aria-hidden="true" />
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
                  <li key={t.id} className="flex items-center">
                    <Link
                      to="/target/$id"
                      params={{ id: t.id }}
                      className="grid flex-1 grid-cols-[1fr_1fr_120px_92px] items-center gap-0 px-0 py-[2px] text-[11px] text-black hover:bg-w95-title hover:text-white focus-visible:bg-w95-title focus-visible:text-white"
                    >
                      <span className="flex min-w-0 items-center gap-1 px-2">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{t.role_title}</span>
                      </span>
                      <span className="truncate px-2">{t.company}</span>
                      <span className="truncate px-2">{t.location ?? "—"}</span>
                      <span className="truncate px-2">{t.status}</span>
                    </Link>
                    {/*
                      Destructive and irreversible, so it confirms by name. A native confirm
                      rather than a new dialog component: impossible to miss, and it adds no
                      design primitive.
                    */}
                    <button
                      type="button"
                      title={`Delete ${t.role_title} at ${t.company}`}
                      aria-label={`Delete ${t.role_title} at ${t.company}`}
                      disabled={destroy.isPending}
                      className="bevel-out grid w-7 shrink-0 cursor-pointer place-items-center self-stretch text-black disabled:opacity-50"
                      onClick={() => {
                        const ok = window.confirm(
                          `Delete "${t.role_title}" at ${t.company}?\n\n` +
                            "Its contacts and every drafted or sent message go with it. " +
                            "This cannot be undone.",
                        );
                        if (ok) destroy.mutate(t.id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </button>
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
