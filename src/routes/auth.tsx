import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Radar, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Win95Window } from "@/components/win95/Window";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ReachPoint recruiter finder" },
      {
        name: "description",
        content:
          "Sign in to ReachPoint to find verified recruiter and hiring manager contacts for the jobs you apply to.",
      },
      { property: "og:title", content: "Sign in — ReachPoint" },
      { property: "og:description", content: "Track job targets and reach real hiring people." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  minLength,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
      <label htmlFor={id} className="text-[11px] text-black">
        {label}:
      </label>
      <Input
        id={id}
        type={type}
        required
        {...(minLength !== undefined ? { minLength } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created. Check your inbox if confirmation is required.");
    navigate({ to: "/dashboard" });
  }

  return (
    <main
      className="desktop-bg flex min-h-screen items-center justify-center px-4 py-10"
      aria-busy={busy}
    >
      <div className="w-full max-w-[420px]">
        <Link to="/" className="mb-4 flex items-center justify-center gap-2 text-white">
          <Radar className="size-5" />
          <span className="text-[13px] font-bold tracking-tight">ReachPoint</span>
        </Link>

        <Win95Window
          title="Connect to ReachPoint"
          icon={<KeyRound className="size-3.5 text-black" />}
          status={[busy ? "Working…" : "Enter your details to continue."]}
          bodyClassName="bg-w95-face p-3"
        >
          <Tabs defaultValue="signin">
            <TabsList>
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">New account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-3">
                <Field id="email" label="E-mail" type="email" value={email} onChange={setEmail} />
                <Field
                  id="password"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="submit" disabled={busy} className="min-w-[80px]">
                    {busy ? "Please wait…" : "OK"}
                  </Button>
                  <Button type="button" variant="secondary" asChild className="min-w-[80px]">
                    <Link to="/">Cancel</Link>
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-3">
                <Field id="name" label="Full name" value={fullName} onChange={setFullName} />
                <Field id="email2" label="E-mail" type="email" value={email} onChange={setEmail} />
                <Field
                  id="password2"
                  label="Password"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={setPassword}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="submit" disabled={busy} className="min-w-[80px]">
                    {busy ? "Please wait…" : "Create"}
                  </Button>
                  <Button type="button" variant="secondary" asChild className="min-w-[80px]">
                    <Link to="/">Cancel</Link>
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </Win95Window>
      </div>
    </main>
  );
}
