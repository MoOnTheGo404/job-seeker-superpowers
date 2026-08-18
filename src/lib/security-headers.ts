import { runtimeEnv } from "./env";

/**
 * Response headers applied to everything the Worker returns.
 *
 * Built as a pure function of (origin, isHttps) so the policy can be reasoned
 * about and adjusted without running the app.
 */

/** Origins the browser is allowed to talk to, beyond our own. */
function connectOrigins(): string[] {
  const supabase = runtimeEnv("VITE_SUPABASE_URL") ?? runtimeEnv("SUPABASE_URL");
  if (!supabase) return [];
  try {
    return [new URL(supabase).origin];
  } catch {
    return [];
  }
}

/**
 * Content-Security-Policy for this app.
 *
 * `'unsafe-inline'` on scripts and styles is a real weakening and is here on
 * purpose: TanStack Start streams SSR by emitting inline bootstrap scripts, and
 * removing it needs per-request nonces threaded through the framework's own
 * output. A nonce-based policy is the upgrade path, not a quick edit.
 *
 * connect-src has to name the Supabase origin explicitly — auth runs in the
 * browser and talks to it directly, so a bare 'self' would silently break
 * sign-in, which is exactly the kind of quiet CSP failure worth avoiding.
 */
export function contentSecurityPolicy(): string {
  const connect = ["'self'", ...connectOrigins()].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // data: covers the hand-drawn Win95 cursors, which are inline SVG in CSS.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(isHttps: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": contentSecurityPolicy(),
    "x-content-type-options": "nosniff",
    // Redundant next to frame-ancestors for modern browsers, kept for older ones.
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    // No camera/mic/geolocation anywhere in this app.
    "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  };

  /*
   * 180 days, no includeSubDomains and no preload.
   *
   * Deliberately the conservative form. Preload is effectively irreversible,
   * and includeSubDomains would commit hosts that do not exist yet — worth
   * adding once a custom domain is settled, not before.
   *
   * Only sent over HTTPS: browsers ignore it on plain HTTP, and omitting it in
   * local development keeps localhost from getting pinned to HTTPS.
   */
  if (isHttps) headers["strict-transport-security"] = "max-age=15552000";

  return headers;
}

/** Statuses whose responses must not carry a body when reconstructed. */
const BODILESS = new Set([101, 103, 204, 205, 304]);

/**
 * Copy a response, adding security headers without clobbering anything the
 * framework already set.
 */
export function withSecurityHeaders(response: Response, isHttps: boolean): Response {
  if (BODILESS.has(response.status)) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(isHttps))) {
    if (!headers.has(name)) headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
