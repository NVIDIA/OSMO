// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

  // =============================================================================
  // Performance Optimizations
  // =============================================================================

  experimental: {
    // Optimize package imports - tree-shake large icon libraries
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
    // CSS optimization - extract and inline critical CSS
    optimizeCss: true,
  },

  // Compiler optimizations
  compiler: {
    // Remove console.log in production (keep errors/warnings)
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  // =============================================================================
  // Proxy & CORS Configuration
  // =============================================================================

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
      // Performance headers for static assets
      {
        source: "/:all*(svg|jpg|jpeg|png|gif|ico|webp|woff|woff2)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Preconnect hints for faster API connections
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
