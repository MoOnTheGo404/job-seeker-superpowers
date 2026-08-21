import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Win95Window, GroupBox } from "@/components/win95/Window";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { EMPTY_PROFILE, isProfileEmpty, MAX_ENTRIES, type ApplicantProfile } from "@/lib/profile";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "About you — ReachPoint" },
      {
        name: "description",
        content: "Your background, stored once and used in every draft.",
      },
    ],
  }),
  component: ProfilePage,
});

/** One item per line, which survives names containing commas. */
const toLines = (list: string[]) => list.join("\n");
const fromLines = (text: string) => text.split(/\r?\n/);

function ProfilePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { query, save } = useProfile(user?.id);

  const [draft, setDraft] = useState<ApplicantProfile>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Seed the form once the server answers, then leave the user's edits alone.
  useEffect(() => {
    if (query.data && !loaded) {
      setDraft(query.data);
      setLoaded(true);
    }
  }, [query.data, loaded]);

  const setEntry = (index: number, patch: Partial<{ title: string; description: string }>) =>
    setDraft((d) => ({
      ...d,
      experience: d.experience.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));

  return (
    <div className="desktop-bg min-h-screen pb-[42px]">
      <AppHeader email={user?.email ?? null} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Win95Window
          title="About you"
          icon={<UserCog className="size-3.5 text-black" />}
          menu={["File", "Edit", "View", "Help"]}
          status={[
            query.isLoading
              ? "Loading…"
              : query.isError
                ? "Couldn't load"
                : save.isPending
                  ? "Saving…"
                  : "Ready",
            "Used in every draft",
          ]}
          bodyClassName="bg-w95-face p-4"
        >
          {query.isError ? (
            <div className="bevel-in-thin bg-w95-info px-3 py-2 text-[11px] text-black">
              <p className="font-bold">Couldn&apos;t load your profile.</p>
              <p className="mt-1">
                {query.error instanceof Error ? query.error.message : "Unknown error."}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-black">
                Drafts can only state what you put here. Anything you leave empty comes back as a{" "}
                <span className="font-mono">[bracketed blank]</span> — the model is instructed never
                to invent your background.
              </p>

              {/*
                Greyed example text is easy to mistake for saved data — it was,
                on first read. Say plainly which state this is in.
              */}
              {!query.isLoading && query.data && isProfileEmpty(query.data) && (
                <p className="bevel-in-thin bg-w95-info px-3 py-2 text-[11px] text-black">
                  Nothing saved yet. The greyed text below is an example, not your data — type over
                  it and choose Save.
                </p>
              )}

              <GroupBox label="Education" className="bg-w95-face">
                <Textarea
                  rows={2}
                  value={draft.education}
                  onChange={(e) => setDraft((d) => ({ ...d, education: e.target.value }))}
                  placeholder="e.g. BSc Mechanical Engineering, 2024"
                />
              </GroupBox>

              <GroupBox label="Schools — one per line" className="bg-w95-face">
                <p className="mb-2 text-[11px] text-w95-muted">
                  Add both the full name and any abbreviation you&apos;d search by; each becomes its
                  own alumni search link.
                </p>
                <Textarea
                  rows={3}
                  value={toLines(draft.schools)}
                  onChange={(e) => setDraft((d) => ({ ...d, schools: fromLines(e.target.value) }))}
                  placeholder={"e.g. Michigan State University\ne.g. MSU"}
                />
              </GroupBox>

              <GroupBox label="Skills — one per line" className="bg-w95-face">
                <Textarea
                  rows={3}
                  value={toLines(draft.skills)}
                  onChange={(e) => setDraft((d) => ({ ...d, skills: fromLines(e.target.value) }))}
                  placeholder={"e.g. Python\ne.g. SQL\ne.g. AutoCAD"}
                />
              </GroupBox>

              <GroupBox label="Experience & projects" className="bg-w95-face">
                <div className="space-y-2">
                  {draft.experience.map((entry, i) => (
                    <div key={i} className="bevel-in-thin space-y-1 bg-w95-field p-2">
                      <Input
                        value={entry.title}
                        onChange={(e) => setEntry(i, { title: e.target.value })}
                        placeholder="e.g. Field Engineer at Turner Construction — or a project name"
                      />
                      <Textarea
                        rows={2}
                        value={entry.description}
                        onChange={(e) => setEntry(i, { description: e.target.value })}
                        placeholder="e.g. Ran daily coordination for a 40-person site crew."
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            experience: d.experience.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  {draft.experience.length === 0 && (
                    <p className="text-[11px] text-w95-muted">Nothing added yet.</p>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={draft.experience.length >= MAX_ENTRIES}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        experience: [...d.experience, { title: "", description: "" }],
                      }))
                    }
                  >
                    Add entry
                  </Button>
                </div>
              </GroupBox>

              <GroupBox label="Anything else" className="bg-w95-face">
                <Textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="e.g. Available from March, open to relocation"
                />
              </GroupBox>

              <div className="flex items-center gap-2">
                <Button
                  disabled={save.isPending || query.isLoading}
                  onClick={() =>
                    save.mutate(draft, {
                      onSuccess: (clean) => {
                        // Show what was actually stored, not what was typed.
                        setDraft(clean);
                        toast.success("Saved");
                      },
                      onError: (e: Error) => toast.error(e.message),
                    })
                  }
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                <span className="text-[11px] text-w95-muted">
                  Stored on your account, not in this browser.
                </span>
              </div>
            </div>
          )}
        </Win95Window>
      </main>
    </div>
  );
}
