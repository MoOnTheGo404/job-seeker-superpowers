import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar, ShieldCheck, Search, Mail, Linkedin, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { Win95Window, GroupBox } from "@/components/win95/Window";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ReachPoint — Find the recruiter behind any job posting" },
      {
        name: "description",
        content:
          "Paste a job link and ReachPoint finds the recruiter or hiring manager, their LinkedIn profile and any publicly published email — always with the source link. No guessed addresses.",
      },
      { property: "og:title", content: "ReachPoint — Find the recruiter behind any job posting" },
      {
        property: "og:description",
        content:
          "Verified recruiter contacts, LinkedIn profiles and outreach drafts for every application.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    icon: Search,
    title: "1. Paste the job",
    body: "Drop in a job link or the full description. We pull out the company, role and real company domain.",
  },
  {
    icon: Linkedin,
    title: "2. Find the humans",
    body: "We search the public web for recruiters, talent partners and hiring managers at that company.",
  },
  {
    icon: Mail,
    title: "3. Only real emails",
    body: "An email appears only when it is published on a public page — with the exact source link.",
  },
];

/** A desktop shortcut: icon over a label, like an item on the Win95 desktop. */
function DesktopIcon({ icon: Icon, label, to }: { icon: typeof Radar; label: string; to: string }) {
  return (
    <Link to={to} className="group flex w-[76px] flex-col items-center gap-1 p-1 text-center">
      <span className="grid size-8 place-items-center">
        <Icon className="size-7 text-white drop-shadow-[1px_1px_0_rgba(0,0,0,0.6)]" />
      </span>
      <span className="px-1 text-[11px] text-white group-hover:bg-w95-title group-focus-visible:bg-w95-title">
        {label}
      </span>
    </Link>
  );
}

function Landing() {
  const { user } = useAuth();

  return (
    <div className="desktop-bg min-h-screen pb-[42px]">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row">
        <nav aria-label="Shortcuts" className="flex shrink-0 gap-2 sm:flex-col">
          <DesktopIcon icon={Radar} label="ReachPoint" to={user ? "/dashboard" : "/auth"} />
          <DesktopIcon icon={FileText} label="My Targets" to={user ? "/dashboard" : "/auth"} />
        </nav>

        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Win95Window
            title="ReachPoint — Find the recruiter behind any job"
            icon={<Radar className="size-3.5 text-black" />}
            menu={["File", "Edit", "View", "Help"]}
            status={["Ready", "No invented emails"]}
            bodyClassName="bg-w95-face p-4"
          >
            <div className="bevel-in-thin mb-4 flex items-start gap-2 bg-w95-info px-3 py-2">
              <ShieldCheck className="mt-[1px] size-4 shrink-0 text-black" />
              <p className="text-[11px] text-black">
                No invented emails. Every address we show comes with the public page it was found
                on.
              </p>
            </div>

            <h1 className="text-[20px] leading-tight font-bold text-black">
              Find the person actually reading your application.
            </h1>
            <p className="mt-2 max-w-[52ch] text-[11px] text-black">
              ReachPoint turns any job posting into a shortlist of real recruiters and hiring
              managers — with their LinkedIn profiles, verifiable public emails, and a short message
              you can actually send.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="lg" className="min-w-[130px]">
                <Link to={user ? "/dashboard" : "/auth"}>
                  {user ? "Open dashboard" : "Start free"}
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="min-w-[110px]">
                <a href="#how">How it works</a>
              </Button>
            </div>
          </Win95Window>

          <Win95Window
            title="How it works"
            icon={<Search className="size-3.5 text-black" />}
            status={["3 steps", "Zero guesswork"]}
            bodyClassName="bg-w95-face p-4"
          >
            <div id="how" className="grid gap-3 sm:grid-cols-3">
              {STEPS.map((s) => (
                <GroupBox key={s.title} label={s.title} className="bg-w95-face">
                  <s.icon className="mb-2 size-6 text-black" />
                  <p className="text-[11px] text-black">{s.body}</p>
                </GroupBox>
              ))}
            </div>

            <div className="bevel-in-thin mt-4 flex flex-wrap items-center justify-between gap-3 bg-w95-face px-3 py-3">
              <div>
                <h2 className="text-[12px] font-bold text-black">Stop applying into the void</h2>
                <p className="mt-1 max-w-[46ch] text-[11px] text-black">
                  Track every application, keep contacts and outreach in one place, and follow up
                  like someone who did their homework.
                </p>
              </div>
              <Button asChild className="min-w-[120px]">
                <Link to={user ? "/dashboard" : "/auth"}>
                  {user ? "Go to dashboard" : "Create account"}
                </Link>
              </Button>
            </div>
          </Win95Window>
        </div>
      </div>

      <AppHeader email={user?.email ?? null} />
    </div>
  );
}
