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

import type { Metadata } from "next";

// =============================================================================
// Static Metadata (SEO)
// =============================================================================

export const metadata: Metadata = {
  title: "Workflows | OSMO",
  description: "Monitor and manage compute workflows, tasks, and job executions.",
};

/**
 * Workflows Page (Streaming SSR)
 *
 * Architecture: Streaming SSR for optimal UX
 * - Page shell renders immediately (fast TTFB, instant first paint)
 * - WorkflowsPageContent streams in via Suspense as data loads
 * - TanStack Query handles data fetching, caching, and background refetching
 */

import { Suspense } from "react";
import { WorkflowsPageContent } from "./workflows-page-content";
import { WorkflowsPageSkeleton } from "./workflows-page-skeleton";

// =============================================================================
// Streaming SSR - Fast TTFB + Progressive Content
// =============================================================================

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<WorkflowsPageSkeleton />}>
      <WorkflowsPageContent />
    </Suspense>
  );
}
