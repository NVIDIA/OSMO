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
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js before the server starts.
 * We use it to set up server-side MSW for mock mode.
 *
 * PRODUCTION SAFETY:
 * This file has ZERO mock code in production builds because:
 * 1. The import is behind `NODE_ENV === "development"` condition
 * 2. Tree-shaking removes the dead code path in production
 * 3. The `@/mocks/server` import is aliased to a no-op stub via next.config.ts
 * 4. Dynamic import only executes in dev mode, never in production
 *
 * IMPORTANT: Uses a singleton pattern to prevent MaxListenersExceededWarning
 * during hot module reloading. MSW server is started exactly once.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * @see https://mswjs.io/docs/integrations/node
 */

// Singleton flag to prevent multiple server.listen() calls during HMR
declare global {
  var __mswServerStarted: boolean | undefined;
}

export async function register() {
  // Only run in Node.js runtime (not Edge) - MSW uses Node.js-specific APIs
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Only enable in development with mock mode
    if (process.env.NEXT_PUBLIC_MOCK_API === "true" && process.env.NODE_ENV === "development") {
      // Singleton guard: only start once across HMR reloads
      if (!globalThis.__mswServerStarted) {
        const { server } = await import("@/mocks/server");

        server.listen({
          onUnhandledRequest(req, print) {
            // Only warn about API requests - ignore Next.js internals, static assets, etc.
            const url = new URL(req.url);
            if (url.pathname.startsWith("/api/") || url.pathname.includes("/api/")) {
              print.warning();
            }
          },
        });
        globalThis.__mswServerStarted = true;
        console.log("[MSW] Server-side mocking enabled");
      }
    }
  }
}
