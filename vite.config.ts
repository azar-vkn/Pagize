// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Prerender every route to static HTML at build time. The app has no runtime
    // server needs (loaders/head read static data only), so this produces a fully
    // static site for Firebase Hosting (Spark/free) — no Cloud Functions.
    // Driven by TanStack Start (not nitro's crawler) so the route manifest is known.
    prerender: {
      enabled: true,
      crawlLinks: true,
      autoStaticPathsDiscovery: true,
      failOnError: false,
    },
  },
  // Disable the Lovable Cloudflare/nitro pipeline so TanStack Start uses its native
  // build (dist/server + dist/client), which is what the prerenderer expects. The
  // prerendered HTML lands in dist/client for static Firebase Hosting.
  nitro: false,
});
