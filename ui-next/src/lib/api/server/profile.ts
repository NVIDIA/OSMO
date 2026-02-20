//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Server-Side Profile Fetching
 *
 * Fetch user profile data on the server for SSR/RSC.
 * Uses React's cache() for request deduplication.
 */

import { QueryClient } from "@tanstack/react-query";
import { profileKeys } from "@/lib/api/adapter/hooks";

// =============================================================================
// Prefetch Functions
// =============================================================================

/**
 * Prefetch user profile settings into a QueryClient for hydration.
 *
 * Must be called alongside prefetchPools() in parallel so the "My Pools"
 * scope filter has accessiblePoolNames available on first render — no
 * client-side waterfall, no flash of 0 pools.
 *
 * Query key matches useProfile() → profileKeys.detail() → ["profile", "detail"]
 *
 * @param queryClient - The QueryClient to prefetch into
 */
export async function prefetchProfile(queryClient: QueryClient): Promise<void> {
  const { getNotificationSettingsApiProfileSettingsGet } = await import("../generated");

  await queryClient.prefetchQuery({
    queryKey: profileKeys.detail(),
    queryFn: () => getNotificationSettingsApiProfileSettingsGet(),
  });
}
