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
 * Server-Side Data Fetching Layer
 *
 * This module provides server-side data fetching functions for use in:
 * - Server Components (async components)
 * - Route Handlers
 * - Server Actions
 *
 * These functions run ONLY on the server and should NEVER be imported
 * in client components (they won't work and will error).
 *
 * Benefits over client-side fetching:
 * - Data is fetched during SSR, not after hydration
 * - HTML is sent with data already rendered (no loading spinners)
 * - Reduced client JavaScript bundle
 * - Server-to-server calls (faster, no CORS)
 * - Can use server-only secrets
 *
 * Usage:
 * ```tsx
 * // In a Server Component (no "use client" directive)
 * import { fetchPools, fetchWorkflows } from '@/lib/api/server';
 *
 * export default async function PoolsPage() {
 *   const pools = await fetchPools();
 *   return <PoolsTable pools={pools} />;
 * }
 * ```
 */

// Server-side fetch functions
export { fetchPools, fetchPoolByName, prefetchPools } from "./pools";
export { fetchResources, fetchResourcesByPool, prefetchResources } from "./resources";
export { fetchWorkflows, fetchWorkflowByName, prefetchWorkflows } from "./workflows";
export { fetchVersion } from "./version";

// Re-export types for convenience
export type { Pool, PoolsResponse } from "../adapter/types";
export type { ServerFetchOptions } from "./config";
