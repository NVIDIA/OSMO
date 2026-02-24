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
 * Sets up server-side MSW for mock mode. Uses a singleton pattern to prevent
 * MaxListenersExceededWarning during HMR.
 *
 * Production safety: `@/mocks/server` is aliased to a no-op stub via next.config.ts,
 * and the dynamic import is behind NODE_ENV + MOCK_API guards.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

declare global {
  var __mswServerStarted: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.NEXT_PUBLIC_MOCK_API !== "true") return;
  if (globalThis.__mswServerStarted) return;

  const { server } = await import("@/mocks/server");

  server.listen({
    onUnhandledRequest(req, print) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) {
        print.warning();
      }
    },
  });

  globalThis.__mswServerStarted = true;
  console.log("[MSW] Server-side mocking enabled");
}
