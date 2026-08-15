import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar, ShieldCheck, Search, Mail, Linkedin, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
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
        content: "Verified recruiter contacts, LinkedIn profiles and outreach drafts for every application.",
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
    title: "Paste the job",
    body: "Drop in a job link or the full description. We pull out the company, role and real company domain.",
  },
  {
    icon: Linkedin,
    title: "Find the humans",
    body: "We search the public web for recruiters, talent partners and hiring managers at that company and link their LinkedIn profiles.",
  },
  {
    icon: Mail,
    title: "Only real emails",
    body: "An email is shown only when it is published on a public page — and we always show you the exact source link.",
  },
];

function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      <AppHeader email={user?.email ?? null} />

      <main>
        <section className="hero-bg">
          <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:py-32">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-success" />
                No invented emails. Sources on every contact.
              </span>
              <h1 className="mt-6 text-5xl leading-[1.05] font-semibold sm:text-6xl">
                Find the person actually reading your application.
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
                ReachPoint turns any job posting into a shortlist of real recruiters and hiring managers — with their
                LinkedIn profiles, verifiable public emails, and a short message you can actually send.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="glow-ring">
                  <Link to={user ? "/dashboard" : "/auth"}>
                    {user ? "Open dashboard" : "Start free"} <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href="#how">How it works</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto w-full max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold">Three steps, zero guesswork</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.title} className="surface-panel rounded-2xl p-6">
                <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                  <s.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-24">
          <div className="surface-panel flex flex-col items-start gap-6 rounded-2xl p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Stop applying into the void</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Track every application, keep contacts and outreach in one place, and follow up like someone who did
                their homework.
              </p>
            </div>
            <Button asChild size="lg">
              <Link to={user ? "/dashboard" : "/auth"}>
                <Radar className="size-4" /> {user ? "Go to dashboard" : "Create your account"}
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 py-8 text-center text-xs text-muted-foreground">
        ReachPoint only surfaces information already published publicly, with a source link for every email.
      </footer>
    </div>
  );
}
