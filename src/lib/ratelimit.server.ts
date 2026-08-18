import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user rate limits on the operations that spend shared API quota.
 *
 * Every user's searches and AI calls run on one Serper key and one Gemini key,
 * so without a ceiling a single enthusiastic user exhausts the month for
 * everyone. These are generous for real use and only bite on automation.
 *
 * Counting happens inside a SECURITY DEFINER function keyed on auth.uid(), so
 * a client cannot spend someone else's allowance or reset its own.
 */
export const LIMITS = {
  /** Cheap: one Gemini call, no search. */
  analyze_job: { limit: 30, windowSeconds: 3600 },
  /** Expensive: up to 3 searches plus per-profile email lookups. */
  discover_contacts: { limit: 12, windowSeconds: 3600 },
  /** Expensive: 3 searches. */
  discover_referrers: { limit: 12, windowSeconds: 3600 },
  /** Cheap, but users iterate on wording, so allow plenty. */
  draft_outreach: { limit: 40, windowSeconds: 3600 },
  /*
   * A single row update, and it fires from ordinary actions — copying a draft,
   * clicking undo, marking a reply. The limit is a runaway guard, not a
   * budget, so it sits high enough that no real session reaches it.
   */
  update_outreach_status: { limit: 300, windowSeconds: 3600 },
  /** Destructive and deliberate; nobody deletes thirty targets an hour. */
  delete_job_target: { limit: 30, windowSeconds: 3600 },
} as const;

export type RateLimitedAction = keyof typeof LIMITS;

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly resetsAt: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

function minutesUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60_000));
}

/**
 * Consume one unit of the user's allowance, or throw.
 *
 * Fails open on an unexpected RPC error: a broken limiter should not take the
 * whole feature offline. The quota ceiling is a safeguard, not a correctness
 * requirement, and the API providers enforce their own limits underneath.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient,
  action: RateLimitedAction,
): Promise<void> {
  const { limit, windowSeconds } = LIMITS[action];

  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.warn(`[ratelimit] check failed for ${action}, allowing: ${error.message}`);
    return;
  }

  const result = data as { allowed: boolean; used: number; resets_at: string } | null;
  if (!result || result.allowed) return;

  throw new RateLimitError(
    `You've hit the limit for this action (${limit} per hour). Try again in ${minutesUntil(
      result.resets_at,
    )} minute(s).`,
    result.resets_at,
  );
}
