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
 * Dashboard Page (Streaming SSR)
 *
 * The main dashboard with key metrics and recent workflows.
 *
 * Architecture: Streaming SSR for optimal UX
 * - Page shell renders immediately (fast TTFB, instant first paint)
 * - Dynamic content streams in via Suspense as data loads
 * - User sees layout/nav instantly, content fills in progressively
 */

import { Suspense } from "react";
import { DashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

// =============================================================================
// Streaming SSR - Fast TTFB + Progressive Content
// =============================================================================

export default function DashboardPage() {
  // Shell renders immediately, DashboardContent fetches data on render
  // and streams in as it becomes available
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
