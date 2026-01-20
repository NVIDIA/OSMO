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
 * MSW Browser Worker for Client-Side Mocking
 *
 * Sets up MSW service worker for browser environments.
 * This enables true HTTP streaming in the browser, bypassing Next.js server.
 *
 * Browser service workers properly handle streaming responses without
 * the MockHttpSocket issues that affect msw/node.
 *
 * @see https://mswjs.io/docs/integrations/browser
 */

import { setupWorker, type SetupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * MSW browser worker instance.
 * Only initialized in browser environment.
 */
export const worker: SetupWorker = setupWorker(...handlers);
