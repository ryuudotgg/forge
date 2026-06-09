import "./env";

import type { NextConfig } from "next";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: __TRANSPILE_PACKAGES__,

  typescript: { ignoreBuildErrors: true }, // We handle this in CI.
} satisfies NextConfig;

export default nextConfig;
