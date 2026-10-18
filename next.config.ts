import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    cpus: 2,
    middlewareClientMaxBodySize: "64kb",
    serverActions: { bodySizeLimit: "64kb" },
  },
};
export default nextConfig;
