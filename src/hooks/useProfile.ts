import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  EMPTY_PROFILE,
  LEGACY_BACKGROUND_KEY,
  LEGACY_SCHOOLS_KEY,
  normalizeProfile,
  planLocalMigration,
  type ApplicantProfile,
} from "@/lib/profile";

/**
 * The signed-in user's profile, read and written under RLS.
 *
 * A direct table access rather than a server function, matching how job target
 * status is already updated: this is a plain column write on a row the policy
 * already scopes to auth.uid(), with no quota to spend and nothing to validate
 * server-side that normalizeProfile does not already do.
 */
export function useProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ApplicantProfile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("schools, education, skills, experience, notes")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return normalizeProfile(data);
    },
  });

  const save = useMutation({
    mutationFn: async (profile: ApplicantProfile) => {
      const clean = normalizeProfile(profile);
      const { error } = await supabase
        .from("profiles")
        .update({
          schools: clean.schools,
          education: clean.education,
          skills: clean.skills,
          // jsonb column: the generated Json type wants an index signature,
          // which a named interface has not got. Widened only at the boundary.
          experience: clean.experience as unknown as Json,
          notes: clean.notes,
        })
        .eq("id", userId!);
      if (error) throw new Error(error.message);
      return clean;
    },
    onSuccess: (clean) => {
      queryClient.setQueryData(["profile", userId], clean);
    },
  });

  return { query, save };
}

/**
 * Move the old localStorage values into the profile, once.
 *
 * Runs on the dashboard rather than the profile page, so it happens on the
 * surface everyone lands on instead of only for someone who goes looking.
 *
 * Safety lives in planLocalMigration, which promotes local data only into an
 * empty server profile: a second device with a stale copy, or a reload landing
 * mid-migration, both resolve to "clear" rather than a second write. The ref
 * here only stops a duplicate attempt within one mounted session; correctness
 * does not depend on it.
 */
export function useLegacyProfileMigration(userId: string | undefined): void {
  const queryClient = useQueryClient();
  const attempted = useRef(false);

  useEffect(() => {
    if (!userId || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("schools, education, skills, experience, notes")
          .eq("id", userId)
          .maybeSingle();
        if (error) return;

        const server = normalizeProfile(data);
        const plan = planLocalMigration(server, {
          background: localStorage.getItem(LEGACY_BACKGROUND_KEY),
          schools: localStorage.getItem(LEGACY_SCHOOLS_KEY),
        });
        if (plan.action === "skip") return;

        if (plan.action === "migrate") {
          const { error: writeError } = await supabase
            .from("profiles")
            .update({
              schools: plan.profile.schools,
              education: plan.profile.education,
              skills: plan.profile.skills,
              experience: plan.profile.experience as unknown as Json,
              notes: plan.profile.notes,
            })
            .eq("id", userId);
          // Leave the local keys alone on failure so the next load retries.
          if (writeError) return;
          queryClient.invalidateQueries({ queryKey: ["profile", userId] });
        }

        localStorage.removeItem(LEGACY_BACKGROUND_KEY);
        localStorage.removeItem(LEGACY_SCHOOLS_KEY);
      } catch {
        // A failed migration must never break the page it runs behind.
      }
    })();
  }, [userId, queryClient]);
}

export { EMPTY_PROFILE };
