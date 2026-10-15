import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Retain PPR by default via the root layout, while allowing database-backed
    // creator routes to opt out and return real request-time HTTP 404 statuses.
    ppr: 'incremental',
    clientSegmentCache: true,
  },
};

export default nextConfig;
