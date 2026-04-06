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

import { request } from "@playwright/test";

/**
 * Pre-compiles all Next.js Turbopack routes before any test runs.
 *
 * Next.js compiles routes on first request (on-demand). Without warmup, the
 * first navigation test to hit /workflows (or any unmocked route) stalls while
 * Turbopack compiles — consuming most of the 10s test timeout and leaving no
 * time for context teardown, causing "Tearing down context exceeded timeout".
 *
 * Hitting each route here (outside any test) triggers compilation and caches
 * the result. Subsequent test navigations get the pre-compiled response
 * immediately, keeping tests fast and teardown clean.
 *
 * Runs after webServer starts but before any test (Playwright guarantees this).
 */
const ROUTES = ["/", "/pools", "/resources", "/workflows", "/occupancy", "/datasets", "/profile"];

export default async function globalSetup() {
  const baseURL = `http://localhost:${process.env.PORT ?? "3000"}`;
  const ctx = await request.newContext({ baseURL });
  await Promise.allSettled(ROUTES.map((route) => ctx.get(route)));
  await ctx.dispose();
}
