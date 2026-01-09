// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import type { NextConfig } from "next";

// =============================================================================
// Backend API Configuration
// =============================================================================
//
// This controls the default backend that the Next.js proxy forwards to.
// Set NEXT_PUBLIC_OSMO_API_HOSTNAME in .env.local
//
// For development, you can switch backends at runtime without restarting:
//   - Sign out and use the environment selector on the login page
//   - Or run in browser console: setBackend("https://your-backend.example.com")
//
// See: README.md "Local Development" section for full documentation.
// =============================================================================

// Backend API URL for production rewrites
// Rewrites proxy all /api/* requests to the configured backend
const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
const scheme = sslEnabled ? "https" : "http";
const API_URL = `${scheme}://${apiHostname}`;

// Check if mock mode is enabled - disables external API proxying
const isMockMode = process.env.NEXT_PUBLIC_MOCK_API === "true";

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
  // Turbopack Configuration
  // =============================================================================

  turbopack: {
    resolveAlias:
      process.env.NODE_ENV === "production"
        ? {
            // Replace debug utilities with no-op stubs in production
            // This eliminates all debug code from the production bundle
            "./utils/debug": "./utils/debug.production",
          }
        : {},
  },

  // =============================================================================
  // Proxy & CORS Configuration
  // =============================================================================

  // Proxy API requests to the backend (avoids CORS issues)
  // In mock mode, don't proxy - let MSW handle client requests and API routes handle server requests
  async rewrites() {
    if (isMockMode) {
      return { beforeFiles: [] };
    }
    return {
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
