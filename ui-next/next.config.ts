import type { NextConfig } from "next";

// Backend API configuration from environment
const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "fernandol-dev.osmo.nvidia.com";
const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
const scheme = sslEnabled ? "https" : "http";
const API_URL = `${scheme}://${apiHostname}`;

const nextConfig: NextConfig = {
  // Enable standalone output for containerized deployments
  output: "standalone",

  // Source maps in production for debugging
  productionBrowserSourceMaps: true,

  // Proxy API requests to the backend (avoids CORS issues)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
