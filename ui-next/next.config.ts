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
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

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



// Base path for serving UI under a subpath (e.g., /v2)
// This allows ui-next to run alongside legacy UI on the same hostname
// - All routes become /v2/* (e.g., /v2/pools, /v2/workflows)
// - Static assets served from /v2/_next/static/*
// - API rewrites still forward to backend /api/* (no /v2 prefix)
//
// Set via NEXT_PUBLIC_BASE_PATH environment variable (configured in Helm chart values)
// Defaults to empty string (root path) for local development
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  // =============================================================================
  // Deployment Configuration
  // =============================================================================

  // Base path for serving UI under a subpath (e.g., /v2)
  // This allows ui-next to run alongside legacy UI on the same hostname
  // - All routes become /v2/* (e.g., /v2/pools, /v2/workflows)
  // - Static assets served from /v2/_next/static/*
  // - API rewrites still forward to backend /api/* (no /v2 prefix)
  basePath: BASE_PATH,

  // Expose basePath as environment variable for client-side code
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },

  // Enable standalone output for containerized deployments
  output: "standalone",

  // Partial Prerendering via cacheComponents (Next.js 16)
  // This is the killer feature for mobile/slow networks:
  // - Static shell (nav, layout) is prerendered at build time
  // - Dynamic content streams in via React Suspense
  // - Users see instant content, no blank loading screens
  //
  // React 19 Compatibility:
  // - All async Server Components use React 19's use() hook for params/searchParams
  // - This provides better TypeScript inference and clearer async boundaries
  // - Combined with cacheComponents, this delivers optimal server-side rendering
  //
  // IMPORTANT: Only enable in production!
  // In development, cacheComponents causes constant re-rendering and slow iteration
  // as Next.js repeatedly analyzes which components can be cached on every file change.
  cacheComponents: process.env.NODE_ENV === "production",

  // Source maps in production for debugging (disable to speed up builds ~30%)
  // Enable temporarily when debugging production issues
  productionBrowserSourceMaps: process.env.ENABLE_SOURCE_MAPS === "true",

  // =============================================================================
  // Performance Optimizations
  // =============================================================================

  // Exclude MSW from server bundling - it's only used in instrumentation for dev mocking
  // This prevents Turbopack from trying to bundle Node.js-specific MSW code for Edge runtime
  serverExternalPackages: ["msw", "@mswjs/interceptors"],

  experimental: {
    // Stale times for client-side navigation caching
    // This makes Back/Forward navigation instant by keeping prefetch cache warm
    staleTimes: {
      dynamic: 30, // 30s for dynamic routes (matches our Query staleTime)
      static: 180, // 3min for static routes
    },

    // CSS optimization - extract and inline critical CSS
    optimizeCss: true,

    // Optimize package imports for libraries with many named exports
    // This ensures only used exports are bundled, reducing bundle size
    // Note: lucide-react is auto-optimized by Next.js
    // See: https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
    optimizePackageImports: [
      // Radix UI components (many named exports per package)
      "@radix-ui/react-collapsible",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-progress",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toggle",
      "@radix-ui/react-tooltip",
      // TanStack libraries
      "@tanstack/react-table",
      // DAG visualization (large library with many exports)
      "@xyflow/react",
      // Drag and drop
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      // Hooks libraries
      "usehooks-ts",
      "@react-hookz/web",
      // Other utilities
      "cmdk",
      "nuqs",
      "class-variance-authority",
    ],
  },

  // Compiler optimizations
  compiler: {
    // Remove console.log in production (keep errors/warnings)
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  // =============================================================================
  // Turbopack Configuration (default bundler in Next.js 16+)
  // =============================================================================
  //
  // Turbopack is the default bundler for BOTH dev and build in Next.js 16+.
  // See: https://nextjs.org/docs/app/api-reference/turbopack
  //
  // Note: webpack() config is IGNORED by Turbopack. Use turbopack.resolveAlias instead.

  turbopack: {
    resolveAlias:
      process.env.NODE_ENV === "production"
        ? {
            // Replace debug utilities with no-op stubs in production
            // This eliminates all debug code from the production bundle
            "./utils/debug": "./utils/debug.production",
            // Replace MockProvider with production stub to eliminate faker/msw from CLIENT bundle
            // This completely removes dev dependencies from the production client bundle
            "@/mocks/MockProvider": "@/mocks/MockProvider.production",
            // Replace MSW server with production stub to eliminate faker/msw from SERVER bundle
            // This ensures instrumentation.ts doesn't pull in any mock code
            "@/mocks/server": "@/mocks/server.production",
            // Replace mock utilities with no-op stubs in production
            "@/mocks/inject-auth": "@/mocks/inject-auth.production",
            // Replace JWT helper with production version (removes cookie parsing for security)
            // Production version ONLY trusts Envoy's Authorization header
            "@/lib/auth/jwt-helper": "@/lib/auth/jwt-helper.production",
          }
        : {},
  },

  // =============================================================================
  // Proxy & CORS Configuration
  // =============================================================================

  // API Proxying via Route Handler (app/api/[...path]/route.ts)
  //
  // We use a catch-all Route Handler instead of rewrites() for API proxying.
  // This allows the backend hostname to be configured at RUNTIME via environment variables,
  // making the Docker image portable across environments (critical for open source).
  //
  // Route Handler Precedence:
  // - /api/health - Specific route (health check)
  // - /api/workflow/[name]/logs - Specific route (log streaming)
  // - /api/[...path] - Catch-all proxy to backend
  //
  // Benefits:
  // - ✅ Backend hostname configurable at runtime (not build time)
  // - ✅ Single Docker image for all environments
  // - ✅ Perfect for open source deployment
  // - ✅ Environment variables read when request is processed
  //
  // Note: Rewrites would require baking backend URL at build time, requiring
  // different images per environment. Route Handler approach is superior.
  //
  // Previous approach (REMOVED):
  // async rewrites() {
  //   return {
  //     afterFiles: [
  //       { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
  //     ],
  //   };
  // }
  //

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
      // Performance headers for static assets - immutable cache for 1 year
      {
        source: "/:all*(svg|jpg|jpeg|png|gif|ico|webp|woff|woff2)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // JavaScript and CSS - immutable for Next.js hashed assets
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Preconnect hints for faster connections
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // Enable early hints (103) for browsers that support it
          { key: "Link", value: "</api>; rel=preconnect" },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
