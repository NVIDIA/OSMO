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
 * MSW Node Server for Server-Side Mocking
 *
 * Sets up MSW for Node.js environments to intercept both:
 * - Direct API calls (relative paths like /api/...)
 * - Proxied backend requests (absolute URLs to the backend)
 *
 * HMR STRATEGY:
 * The MSW server instance is stored on globalThis so it survives Turbopack
 * hot module reloads. When handlers.ts or any generator file changes,
 * handlers.ts pushes fresh handlers onto the globalThis singleton via
 * resetHandlers(), without needing to import this module (avoiding circulars).
 *
 * Why this matters:
 * 1. instrumentation.ts calls server.listen() exactly once (singleton guard)
 * 2. MSW patches Node.js http.ClientRequest at the process level
 * 3. On HMR, Turbopack re-evaluates handlers.ts (creating new handler instances)
 *    but the running MSW server still holds OLD handler references
 * 4. handlers.ts calls globalThis.__mswServer.resetHandlers() at module scope
 *    to atomically swap in the fresh handlers on every HMR cycle
 *
 * @see https://mswjs.io/docs/integrations/node
 * @see https://mswjs.io/docs/api/setup-server/reset-handlers
 */

import { setupServer, type SetupServer } from "msw/node";
import { handlers } from "@/mocks/handlers";

// Extend globalThis to hold the singleton server instance
declare global {
  var __mswServer: SetupServer | undefined;
}

// =============================================================================
// Server Instance (HMR-safe singleton)
// =============================================================================

/**
 * Get or create the MSW server instance.
 *
 * On first load: creates a new server with current handlers.
 * On HMR reload: returns the existing globalThis singleton.
 *   (handlers.ts pushes fresh handlers via globalThis.__mswServer.resetHandlers())
 *
 * The handlers use relative paths which MSW matches against both:
 * - Relative URL requests (from browser via dev server)
 * - Absolute URL requests (MSW extracts the path and matches)
 *
 * @see https://mswjs.io/docs/best-practices/using-with-typescript
 */
function getOrCreateServer(): SetupServer {
  if (globalThis.__mswServer) {
    return globalThis.__mswServer;
  }

  // First load: create server with initial handlers
  const newServer = setupServer(...handlers);
  globalThis.__mswServer = newServer;
  return newServer;
}

export const server: SetupServer = getOrCreateServer();
