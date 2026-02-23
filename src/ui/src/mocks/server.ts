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
 * MSW Node Server (HMR-safe singleton)
 *
 * The server instance lives on globalThis to survive Turbopack HMR reloads.
 * On HMR, handlers.ts calls globalThis.__mswServer.resetHandlers() to swap
 * in fresh handlers without restarting the server.
 *
 * @see https://mswjs.io/docs/integrations/node
 */

import { setupServer, type SetupServer } from "msw/node";
import { handlers } from "@/mocks/handlers";

declare global {
  var __mswServer: SetupServer | undefined;
}

function getOrCreateServer(): SetupServer {
  if (globalThis.__mswServer) {
    return globalThis.__mswServer;
  }

  const newServer = setupServer(...handlers);
  globalThis.__mswServer = newServer;
  return newServer;
}

export const server: SetupServer = getOrCreateServer();
