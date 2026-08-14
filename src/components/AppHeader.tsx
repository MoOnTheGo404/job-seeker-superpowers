import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Radar, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  // Rendered only after mount — the server and the client would otherwise
  // disagree on the time and React would report a hydration mismatch.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bevel-in-thin min-w-[62px] px-2 py-[3px] text-center text-[11px] text-black">
      {now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : " "}
    </div>
  );
}

/**
 * The taskbar. Fixed to the bottom of the viewport like the real thing, so
 * every page needs bottom padding to clear it (see `pb-[42px]` on the routes).
 */
export function AppHeader({ email }: { email?: string | null }) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-1 border-t-2 border-t-w95-light bg-w95-face px-1 py-[3px]">
      <Link
        to="/"
        className="bevel-out flex shrink-0 items-center gap-1 px-2 py-[3px] text-[11px] font-bold text-black active:bevel-pressed"
      >
        <Radar className="size-4" />
        Start
      </Link>

      <div className="mx-1 h-[22px] w-[2px] shrink-0 border-l border-l-w95-shadow border-r border-r-w95-light" />

      <div className="min-w-0 flex-1">
        {email ? (
          <span className="bevel-in-thin inline-block max-w-full truncate px-2 py-[3px] text-[11px] text-black">
            {email}
          </span>
        ) : null}
      </div>

      {email ? (
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
          className="bevel-out flex shrink-0 items-center gap-1 px-2 py-[3px] text-[11px] text-black active:bevel-pressed"
        >
          <LogOut className="size-3" /> Sign out
        </button>
      ) : (
        <Link
          to="/auth"
          className="bevel-out shrink-0 px-2 py-[3px] text-[11px] text-black active:bevel-pressed"
        >
          Sign in
        </Link>
      )}

      <Clock />
    </div>
  );
}
