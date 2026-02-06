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

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Chrome } from "@/components/chrome/chrome";
import { prefetchVersion } from "@/lib/api/server/version";
import { createQueryClient } from "@/lib/query-client";

/**
 * Dashboard layout with shared data prefetch.
 *
 * Prefetches shared data needed by layout-level components (like Header):
 * - Version: Used by Header, static metadata that rarely changes
 *
 * This ensures useVersion() in Header finds data in cache during SSR,
 * avoiding network requests that would fail in mock mode.
 *
 * STREAMING: We start the prefetch but don't await it, allowing the shell
 * to render immediately. The HydrationBoundary will include any cached data
 * that resolves before the response finishes streaming.
 *
 * Error handling is automatic via Next.js error.tsx files:
 * - (dashboard)/error.tsx - Catches all dashboard errors
 * - (dashboard)/pools/error.tsx - Catches pool-specific errors
 * - (dashboard)/resources/error.tsx - Catches resource-specific errors
 * */
export default async function DashboardLayout(props: { children: React.ReactNode }) {
  // Start prefetch in parallel - don't block the layout render
  // The query will populate the cache; client will use cached data or refetch
  const queryClient = createQueryClient();

  // Fire-and-forget prefetch - allows shell to stream immediately
  // Version endpoint is fast and cached; blocking on it delays everything
  void prefetchVersion(queryClient);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Chrome>{props.children}</Chrome>
    </HydrationBoundary>
  );
}
