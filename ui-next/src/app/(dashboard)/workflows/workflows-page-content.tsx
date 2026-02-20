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

"use client";

import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { usePage } from "@/components/chrome/page-context";
import { useResultsCount } from "@/hooks/use-results-count";
import { useDefaultFilter } from "@/hooks/use-default-filter";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useCallback, useMemo } from "react";
import { WorkflowsDataTable } from "@/app/(dashboard)/workflows/components/table/workflows-data-table";
import { WorkflowsToolbar } from "@/app/(dashboard)/workflows/components/workflows-toolbar";
import { useWorkflowsData } from "@/app/(dashboard)/workflows/hooks/use-workflows-data";
import { useWorkflowsTableStore } from "@/app/(dashboard)/workflows/stores/workflows-table-store";
import { useWorkflowsAutoRefresh } from "@/app/(dashboard)/workflows/hooks/use-workflows-auto-refresh";
import { useUser } from "@/lib/auth/user-context";
import type { SearchChip } from "@/stores/types";

interface WorkflowsPageContentProps {
  initialUsername?: string | null;
}

export function WorkflowsPageContent({ initialUsername }: WorkflowsPageContentProps) {
  usePage({ title: "Workflows" });
  const { startTransition: startViewTransition } = useViewTransition();
  const { user } = useUser();

  const currentUsername = initialUsername ?? user?.username ?? null;

  const { effectiveChips, handleChipsChange, optOut } = useDefaultFilter({
    field: "user",
    defaultValue: initialUsername,
    label: `User: ${initialUsername}`,
  });

  const handleSearchChipsChange = useCallback(
    (chips: SearchChip[]) => startViewTransition(() => handleChipsChange(chips)),
    [handleChipsChange, startViewTransition],
  );

  const sortState = useWorkflowsTableStore((s) => s.sort);
  const sortDirection: "ASC" | "DESC" = sortState?.direction === "asc" ? "ASC" : "DESC";

  const autoRefresh = useWorkflowsAutoRefresh();

  const {
    workflows,
    allWorkflows,
    isLoading,
    error,
    refetch,
    hasMore,
    fetchNextPage,
    isFetchingNextPage,
    total,
    filteredTotal,
    hasActiveFilters,
  } = useWorkflowsData({
    searchChips: effectiveChips,
    showAllUsers: optOut,
    sortDirection,
    refetchInterval: autoRefresh.effectiveInterval,
  });

  const resultsCount = useResultsCount({ total, filteredTotal, hasActiveFilters });

  const autoRefreshProps = useMemo(
    () => ({
      interval: autoRefresh.interval,
      setInterval: autoRefresh.setInterval,
      onRefresh: refetch,
      isRefreshing: isLoading,
    }),
    [autoRefresh.interval, autoRefresh.setInterval, refetch, isLoading],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <WorkflowsToolbar
            workflows={allWorkflows}
            searchChips={effectiveChips}
            onSearchChipsChange={handleSearchChipsChange}
            resultsCount={resultsCount}
            currentUsername={currentUsername}
            autoRefreshProps={autoRefreshProps}
          />
        </InlineErrorBoundary>
      </div>

      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display workflows table"
          resetKeys={[workflows.length]}
          onReset={refetch}
        >
          <WorkflowsDataTable
            workflows={workflows}
            totalCount={total}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
            hasNextPage={hasMore}
            onLoadMore={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
}
