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
 * Server-side MSW setup for Next.js API routes.
 *
 * This intercepts fetch calls made by server-side code (API routes, server components)
 * so that mock mode works without polluting route handlers with mock logic.
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Server-side handlers for auth endpoints that the API routes call
const serverHandlers = [
  // Mock the backend's /api/auth/login endpoint (called by getLoginInfo)
  http.get("http://localhost:8080/api/auth/login", () => {
    return HttpResponse.json({
      auth_enabled: false,
      device_endpoint: "",
      device_client_id: "",
      browser_endpoint: "",
      browser_client_id: "mock-client",
      token_endpoint: "",
      logout_endpoint: "",
    });
  }),
];

export const server = setupServer(...serverHandlers);
