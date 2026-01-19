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
 * @see https://mswjs.io/docs/integrations/node
 */

import { setupServer, type SetupServer } from "msw/node";
import { handlers } from "./handlers";

// =============================================================================
// Server Instance
// =============================================================================

/**
 * MSW server instance for Node.js.
 *
 * The handlers use relative paths which MSW matches against both:
 * - Relative URL requests (from browser via dev server)
 * - Absolute URL requests (MSW extracts the path and matches)
 *
 * @see https://mswjs.io/docs/best-practices/using-with-typescript
 */
export const server: SetupServer = setupServer(...handlers);
