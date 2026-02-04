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
 * WorkflowSpecViewer - Container component for spec viewing
 *
 * Composes SpecToolbar and SpecCodePanel with:
 * - Data fetching via useSpecData
 * - View state management via useSpecViewState
 * - Loading, error, and empty states
 */

"use client";

import { memo } from "react";
import { FileCode, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { SpecToolbar } from "./SpecToolbar";
import { SpecCodePanel } from "./SpecCodePanel";
import { useSpecData } from "./hooks/useSpecData";
import { useSpecViewState } from "./hooks/useSpecViewState";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowSpecViewerProps {
  /** Workflow ID/name for fetching spec */
  workflowId: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Predetermined widths for skeleton lines (avoids impure Math.random in render) */
const SKELETON_WIDTHS = ["65%", "45%", "78%", "52%", "60%", "70%", "40%", "55%"];

// =============================================================================
// Sub-components
// =============================================================================

/** Loading skeleton for spec content */
const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div
      className="flex h-full flex-col"
      aria-label="Loading specification"
    >
      {/* Toolbar skeleton */}
      <div className="border-border bg-muted/30 flex h-11 items-center justify-between border-b px-3">
        <div className="flex gap-1">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-16" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </div>

      {/* Code skeleton */}
      <div className="flex-1 bg-[#1e1e1e] p-4">
        <div className="space-y-2">
          {SKELETON_WIDTHS.map((width, i) => (
            <div
              key={i}
              className="flex gap-4"
            >
              <Skeleton className="h-4 w-8 bg-zinc-700/50" />
              <Skeleton
                className="h-4 bg-zinc-700/50"
                style={{ width }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/** Empty state when no spec available */
const EmptyState = memo(function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="bg-muted rounded-full p-4">
        <FileCode className="text-muted-foreground size-8" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Workflow Spec Not Available</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          The workflow specification has not been loaded yet, or is not available for this workflow.
        </p>
      </div>
    </div>
  );
});

/** Error state with retry button */
interface ErrorStateProps {
  error: Error;
  onRetry: () => void;
}

const ErrorState = memo(function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="bg-destructive/10 rounded-full p-4">
        <AlertTriangle className="text-destructive size-8" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Failed to Load Spec</h3>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {error.message || "An error occurred while loading the specification."}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="gap-2"
      >
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const WorkflowSpecViewer = memo(function WorkflowSpecViewer({ workflowId }: WorkflowSpecViewerProps) {
  // View state (URL-synced)
  const { activeView, setActiveView } = useSpecViewState();

  // Data fetching
  const { content, isLoading, error, isNotFound, refetch } = useSpecData(workflowId, activeView);

  // Show loading skeleton on initial load
  if (isLoading && !content) {
    return <LoadingSkeleton />;
  }

  // Show empty state for 404 or empty content
  if (isNotFound || (content === null && !isLoading && !error)) {
    return <EmptyState />;
  }

  // Show error state
  if (error && !content) {
    return (
      <ErrorState
        error={error}
        onRetry={refetch}
      />
    );
  }

  // Main content view
  return (
    <div className="flex h-full flex-col">
      <SpecToolbar
        activeView={activeView}
        onViewChange={setActiveView}
        content={content}
        workflowName={workflowId}
        isLoading={isLoading}
      />

      <div className="relative flex-1 overflow-hidden">
        {content ? (
          <SpecCodePanel
            content={content}
            language={activeView}
            className="absolute inset-0"
          />
        ) : (
          <LoadingSkeleton />
        )}
      </div>
    </div>
  );
});
