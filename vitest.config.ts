import { defineConfig } from "vitest/config";

/*
 * Deliberately separate from vite.config.ts.
 *
 * Vitest picks up the app's Vite config by default, which would load the
 * TanStack Start and nitro plugins and spin up a dev-server pipeline these
 * tests never touch — that leaves the process hanging on exit. Unit tests here
 * cover pure modules only, so they need no plugins at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
