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
 * Dashboard Page (Streaming SSR with Server Prefetch)
 *
 * The main dashboard with key metrics and recent workflows.
 *
 * Architecture: Hybrid streaming for optimal UX
 * 1. Page shell + skeleton stream immediately (fast TTFB)
 * 2. DashboardWithData suspends while prefetching all data in parallel
 * 3. When APIs respond, content streams in and replaces skeleton
 * 4. Client hydrates with data already in cache (no client fetch!)
 *
 * Performance:
 * - TTFB: ~100ms (shell + skeleton)
 * - Parallel prefetch: pools, workflows, version all fetched simultaneously
 * - Client network requests: 0 (data in hydrated cache)
 */

import { Suspense } from "react";
import { DashboardSkeleton } from "@/app/(dashboard)/dashboard-skeleton";
import { DashboardWithData } from "@/app/(dashboard)/dashboard-with-data";

// =============================================================================
// Streaming SSR - Fast TTFB + Server Prefetch
// =============================================================================

export default function DashboardPage() {
  // No await - returns immediately with skeleton
  // DashboardWithData suspends and streams when data is ready
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardWithData />
    </Suspense>
  );
}
