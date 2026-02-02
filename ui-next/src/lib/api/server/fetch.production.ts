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
 * Production Server Fetch Stub
 *
 * This module is aliased in production builds via Turbopack:
 * - turbopack.resolveAlias["@/lib/api/server/fetch"] = "@/lib/api/server/fetch.production"
 *
 * In production, serverFetch is just native fetch with zero overhead.
 * All mock-related code from fetch.ts is completely excluded from the bundle.
 *
 * IMPORTANT: This module's API MUST match fetch.ts exactly.
 */

/**
 * In production, serverFetch is just native fetch.
 * No mock logic, no handler invocation, zero overhead.
 */
export const serverFetch = fetch;

/**
 * Type-safe wrapper (same as serverFetch in production).
 */
export const serverFetchWithCache = fetch;
