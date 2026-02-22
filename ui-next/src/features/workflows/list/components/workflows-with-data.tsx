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
import { prefetchWorkflowsList } from "@/lib/api/server/workflows";
import { WorkflowsPageContent } from "@/features/workflows/list/components/workflows-page-content";
import { parseUrlChips } from "@/lib/url-utils";
import { createServerQueryClient } from "@/lib/query-client";
import { getServerUsername } from "@/lib/auth/server";

interface WorkflowsWithDataProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function WorkflowsWithData({ searchParams }: WorkflowsWithDataProps) {
  const queryClient = createServerQueryClient();
  const params = await searchParams;
  const filterChips = parseUrlChips(params.f);

  const username = await getServerUsername();
  const allParam = params.all === "true";
  const hasUserChipInUrl = filterChips.some((c) => c.field === "user");
  const shouldPrePopulate = !hasUserChipInUrl && !allParam && !!username;

  const prefetchChips = shouldPrePopulate
    ? [...filterChips, { field: "user", value: username!, label: `User: ${username}` }]
    : filterChips;

  try {
    await prefetchWorkflowsList(queryClient, prefetchChips);
  } catch (error) {
    console.debug(
      "[Server Prefetch] Could not prefetch workflows:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkflowsPageContent initialUsername={username} />
    </HydrationBoundary>
  );
}
