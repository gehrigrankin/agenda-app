import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the SQL migration files with the migrate route so the runtime
  // migrator can read them (Next only bundles statically-traced files).
  outputFileTracingIncludes: {
    "/api/db/migrate": ["./drizzle/**/*"],
  },

  /**
   * Version skew protection. A server action is pinned to the build that
   * produced it, so an open tab whose bundle predates a deploy has every
   * action 404 — autosave included, silently, until the page is reloaded.
   * Stamping the deployment id lets Vercel route those requests back to the
   * deployment the tab actually came from.
   *
   * Requires "Skew Protection" to be ON in the Vercel project settings; the
   * env var is unset everywhere else, which leaves this undefined and the
   * behaviour unchanged (local dev, other hosts).
   */
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
};

export default nextConfig;
