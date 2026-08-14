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
    nitro(),
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
