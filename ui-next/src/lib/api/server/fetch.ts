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

/**
 * Server-Side Fetch with Automatic MSW Integration (Development)
 *
 * This module provides a transparent fetch implementation that:
 * - In development with NEXT_PUBLIC_MOCK_API=true: routes through MSW handlers
 * - In production: aliased to fetch.production.ts (native fetch, zero overhead)
 *
 * CRITICAL ARCHITECTURE DECISION:
 * ================================
 * Next.js 16 patches globalThis.fetch AFTER instrumentation.ts runs, which means:
 * 1. MSW's server.listen() patches fetch first
 * 2. Next.js overwrites MSW's patch with its own enhanced fetch
 * 3. MSW interception breaks for all fetch calls
 *
 * Instead of fighting this, we:
 * 1. Import this module wherever server-side fetch is needed
 * 2. In mock mode, we directly invoke MSW handlers (bypassing globalThis.fetch entirely)
 * 3. In production, Turbopack aliases this to fetch.production.ts (native fetch)
 *
 * USAGE:
 * ======
 * Replace `await fetch(url, init)` with `await serverFetch(url, init)`:
 *
 * ```typescript
 * // Before (doesn't work with MSW in Next.js 16):
 * const response = await fetch(url, { headers, next: { revalidate: 60 } });
 *
 * // After (works transparently in dev and prod):
 * import { serverFetch } from "@/lib/api/server/fetch";
 * const response = await serverFetch(url, { headers, next: { revalidate: 60 } });
 * ```
 *
 * The production build uses Turbopack alias to replace this module entirely:
 * - next.config.ts: turbopack.resolveAlias["@/lib/api/server/fetch"] = "@/lib/api/server/fetch.production"
 *
 * This ensures:
 * - Zero mock code in production bundles
 * - Zero runtime overhead in production
 * - Seamless mock interception in development
 *
 * @see /src/mocks/handlers.ts - MSW request handlers
 * @see /next.config.ts - Turbopack aliasing configuration
 */

import { handlers } from "@/mocks/handlers";

/**
 * Generate a unique request ID for MSW handler invocation.
 */
function generateRequestId(): string {
  return `server-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Invoke MSW handlers directly without network calls.
 *
 * This bypasses globalThis.fetch entirely, avoiding Next.js's fetch patching.
 *
 * @param request - The request to handle
 * @returns Response from matching handler, or null if no handler matches
 */
async function invokeHandler(request: Request): Promise<Response | null> {
  const requestId = generateRequestId();

  for (const handler of handlers) {
    try {
      const result = await handler.run({
        request: request as Parameters<typeof handler.run>[0]["request"],
        requestId,
      });

      if (result?.response) {
        return result.response;
      }
    } catch (error) {
      // Handler threw an error - this shouldn't happen for normal requests
      // Log and continue to next handler
      console.error("[serverFetch] Handler error:", error);
    }
  }

  return null;
}

/**
 * Check if a URL should be intercepted by mock handlers.
 *
 * We intercept:
 * - /api/* paths (relative or absolute)
 * - Any URL containing /api/ segment
 *
 * We do NOT intercept:
 * - Non-API paths (static assets, etc.)
 * - External APIs that we don't mock
 */
function shouldIntercept(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith("/api/") || parsed.pathname.includes("/api/");
  } catch {
    // Relative URL, check path directly
    return url.startsWith("/api/") || url.includes("/api/");
  }
}

/**
 * Server-side fetch with automatic MSW interception in mock mode.
 *
 * This function has the same signature as native fetch(), making it a drop-in replacement.
 * The `next` option for caching is preserved and passed through to the real fetch when
 * MSW handlers don't match.
 *
 * BEHAVIOR:
 * - If URL matches an MSW handler: returns mocked response (no network call)
 * - If URL doesn't match any handler: falls through to native fetch (with warning)
 *
 * Note: In production, this entire module is aliased to fetch.production.ts,
 * which is just `export const serverFetch = fetch` - zero overhead.
 *
 * @param input - URL string, URL object, or Request object
 * @param init - Fetch options (headers, method, body, next, etc.)
 * @returns Promise<Response>
 */
export async function serverFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  // Only intercept API requests
  if (shouldIntercept(url)) {
    // Create a proper Request object for MSW
    const request = new Request(input, init);

    // Try to invoke a mock handler
    const mockResponse = await invokeHandler(request);
    if (mockResponse) {
      return mockResponse;
    }

    // No handler matched - warn and fall through to real fetch
    // This is helpful for detecting missing mock handlers during development
    console.warn(`[serverFetch] No mock handler matched for: ${url}`);
  }

  // Not an API request or no handler matched - use real fetch
  // This preserves Next.js's enhanced fetch with caching support
  return fetch(input, init);
}

/**
 * Type-safe wrapper that preserves Next.js fetch options.
 *
 * This is the same as serverFetch but with explicit Next.js types for better IDE support.
 * Use this when you need TypeScript to recognize the `next` option.
 */
export const serverFetchWithCache = serverFetch as typeof fetch;
