import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    port: 8080,
    host: true,
  },
  plugins: [
    tailwindcss(),
    // Redirect TanStack Start's bundled server entry to src/server.ts, our SSR
    // error wrapper. nitro builds from this.
    tanstackStart({ server: { entry: "server" } }),
    /*
     * Cloudflare Pages by default; override with NITRO_PRESET for anywhere else
     * (`node-server` for a plain container, `vercel` for Vercel).
     *
     * Cloudflare suits this app specifically: it bills CPU time rather than
     * wall time, and discovery is almost entirely spent waiting on network, so
     * a run that takes half a minute costs almost no billable compute. Hosts
     * that cap wall-clock function duration are a much worse fit.
     *
     * Note the free tier allows 50 outbound subrequests per invocation — the
     * discovery fan-out in discovery.server.ts is sized to stay under it.
     */
    nitro({
      preset: process.env["NITRO_PRESET"] ?? "cloudflare_module",
      cloudflare: {
        wrangler: {
          /*
           * Without this, `wrangler deploy` treats the generated config as the
           * whole truth and DELETES every environment variable set in the
           * Cloudflare dashboard — nitro emits no `vars` block, so the deploy
           * reads as "remove them all". It silently wiped the Supabase config
           * on the first successful deploy.
           *
           * keep_vars leaves dashboard-managed vars alone. Secrets were never
           * affected; wrangler manages those separately.
           */
          keep_vars: true,
        },
      },
    }),
    viteReact(),
  ],
  resolve: {
    // Resolves the "@/*" -> "./src/*" mapping from tsconfig.json. Native to
    // Vite 8, which supersedes the vite-tsconfig-paths plugin.
    tsconfigPaths: true,
    // Multiple copies of React or the TanStack router break hooks and context
    // at runtime, so pin every importer to one instance.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "@tanstack/react-start",
    ],
  },
});
