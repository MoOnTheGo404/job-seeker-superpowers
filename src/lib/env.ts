/**
 * Read a server-side environment variable, whatever the runtime.
 *
 * Node puts these on `process.env`. Cloudflare Workers do not: the environment
 * arrives as the second argument to the worker's `fetch` handler, and nitro
 * stashes it on `globalThis.__env__`. The `nodejs_compat` flag also mirrors
 * bindings onto `process.env` for recent compatibility dates — but relying on
 * that alone makes the app depend on a compat-date detail that is easy to
 * change by accident and produces a blank 500 when it does.
 *
 * Checking both is cheap and removes a whole class of works-locally-fails-on-
 * deploy bugs.
 *
 * Isomorphic on purpose. In a browser neither source exists, so this returns
 * undefined and callers fall back to `import.meta.env`, which Vite inlines at
 * build time. It deliberately is NOT a `.server` module: the Supabase client is
 * shared between browser and server, and TanStack Start's import protection
 * (correctly) refuses a `.server` import from client-reachable code.
 */
export function runtimeEnv(key: string): string | undefined {
  const fromProcess = typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  if (fromProcess) return fromProcess;

  const cloudflareEnv = (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const fromCloudflare = cloudflareEnv?.[key];
  return typeof fromCloudflare === "string" && fromCloudflare ? fromCloudflare : undefined;
}
