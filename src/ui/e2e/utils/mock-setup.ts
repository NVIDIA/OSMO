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

import { type Page } from "@playwright/test";
import type { PoolResponse, ResourcesResponse } from "@/lib/api/generated";
import { createLoginInfo, createVersion } from "@/mocks/factories";

// ── Pre-serialized static responses ───────────────────────────────────────────
// Computed once at module load. Using `body` + `contentType` instead of `json`
// avoids JSON.stringify on every route match.

const CT_JSON = "application/json";

const AUTH_DISABLED_BODY = JSON.stringify(createLoginInfo({ auth_enabled: false }));
const VERSION_BODY = JSON.stringify(createVersion());

// ── Default setup ─────────────────────────────────────────────────────────────

/**
 * Sets up auth-disabled and version routes. Call in beforeEach.
 *
 * Two isolation guarantees:
 *
 * 1. page.unrouteAll() — clears stale handlers from a previous test run.
 *    In Playwright's --ui "Reuse browser" mode the same page object is kept
 *    alive across tests. Without this, prior handlers accumulate and win over
 *    the current test's handlers (Playwright uses LIFO: last registered = first
 *    tried, so stale handlers registered earlier are tried last but still fire
 *    if a later handler falls through).
 *
 * 2. Catch-all abort for unmatched /api/** — registered FIRST so it is tried
 *    LAST (LIFO). Specific routes registered afterwards always take priority.
 *    Any API call the test does not explicitly mock is aborted immediately,
 *    preventing in-flight requests (e.g. TanStack Query refetchOnWindowFocus)
 *    from outliving the test and blocking context teardown, which would
 *    manifest as "Tearing down context exceeded timeout" + zip corruption.
 */
export async function setupDefaultMocks(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  // Catch-all registered first → tried last (LIFO). Specific mocks win.
  // Returns 404 instead of aborting: route.abort() emits a network-level error
  // which TanStack Query treats as a disconnect, triggering refetchOnReconnect
  // and up to 3 retries with exponential backoff (~7s total). A 404 response
  // is treated as a non-retryable 4xx by clientRetry, so queries fail fast
  // with no retry storm during context teardown.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Not mocked"}' }),
  );
  await Promise.all([setupAuthDisabled(page), setupVersion(page)]);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function setupProfile(page: Page, accessiblePools: string[] = []): Promise<void> {
  await page.route("**/api/profile/settings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ profile: {}, roles: [], pools: accessiblePools }),
    }),
  );
}

export async function setupAuthDisabled(page: Page): Promise<void> {
  await page.route("**/auth/login_info*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body: AUTH_DISABLED_BODY }),
  );
}

// ── API data ──────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  detail: string;
}

export async function setupPools(page: Page, data: PoolResponse | ApiError): Promise<void> {
  const response =
    "detail" in data
      ? { status: data.status, contentType: CT_JSON, body: JSON.stringify({ detail: data.detail }) }
      : { status: 200, contentType: CT_JSON, body: JSON.stringify(data) };

  await page.route("**/api/pool_quota*", (route) => route.fulfill(response));
}

export async function setupResources(
  page: Page,
  data: ResourcesResponse | ApiError,
): Promise<void> {
  if ("detail" in data) {
    const response = {
      status: data.status,
      contentType: CT_JSON,
      body: JSON.stringify({ detail: data.detail }),
    };
    await page.route("**/api/resources*", (route) => route.fulfill(response));
    return;
  }

  const successBody = JSON.stringify(data);
  await page.route("**/api/resources*", (route) => {
    const url = new URL(route.request().url());
    const pools = url.searchParams.getAll("pools");
    if (pools.length > 0 && url.searchParams.get("all_pools") !== "true") {
      const filtered = {
        resources:
          data.resources?.filter((r) => {
            const pp =
              ((r.exposed_fields as Record<string, unknown>)?.["pool/platform"] as string[]) ?? [];
            return pp.some((p) => pools.some((pool) => p.startsWith(`${pool}/`)));
          }) ?? [],
      };
      return route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(filtered) });
    }
    return route.fulfill({ status: 200, contentType: CT_JSON, body: successBody });
  });
}

/** Registers pool and resource routes in parallel. */
export async function setupPoolsAndResources(
  page: Page,
  pools: PoolResponse | ApiError,
  resources: ResourcesResponse | ApiError,
): Promise<void> {
  await Promise.all([setupPools(page, pools), setupResources(page, resources)]);
}

// ── Auth infrastructure ───────────────────────────────────────────────────────

export async function setupVersion(page: Page): Promise<void> {
  await page.route("**/api/version*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body: VERSION_BODY }),
  );
}
