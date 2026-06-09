import "./env";

import type { NextConfig } from "next";

const nextConfig = {
  transpilePackages: __TRANSPILE_PACKAGES__,

  typescript: { ignoreBuildErrors: true }, // CI handles type checking.
} satisfies NextConfig;

export default nextConfig;
