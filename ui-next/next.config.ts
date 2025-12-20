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
    return {
      // Run before filesystem (pages/public files) and dynamic routes
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${API_URL}/api/:path*`,
        },
      ],
    };
  },

  // Handle CORS for preflight requests during development
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-osmo-auth" },
        ],
      },
    ];
  },
};

export default nextConfig;
