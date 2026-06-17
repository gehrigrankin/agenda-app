import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the SQL migration files with the migrate route so the runtime
  // migrator can read them (Next only bundles statically-traced files).
  outputFileTracingIncludes: {
    "/api/db/migrate": ["./drizzle/**/*"],
  },
};

export default nextConfig;
