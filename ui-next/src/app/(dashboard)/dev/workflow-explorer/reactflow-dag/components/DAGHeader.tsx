// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAGHeader Component
 *
 * Header bar for the DAG visualization page.
 * Displays workflow status, stats, and action buttons.
 */

"use client";

import { useMemo } from "react";
import { ChevronLeft, RefreshCw, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroupWithLayout } from "../../workflow-types";
import { formatDuration } from "../../workflow-types";
import { getStatusIcon } from "../utils/status";

interface DAGHeaderProps {
  /** Workflow status */
  status: string;
  /** Workflow duration in seconds */
  duration: number | null | undefined;
  /** Groups with layout info */
  groups: GroupWithLayout[];
  /** Whether layout is being calculated */
  isLayouting: boolean;
  /** Expand all callback */
  onExpandAll: () => void;
  /** Collapse all callback */
  onCollapseAll: () => void;
  /** Back URL */
  backUrl?: string;
}

export function DAGHeader({
  status,
  duration,
  groups,
  isLayouting,
  onExpandAll,
  onCollapseAll,
  backUrl = "/dev/workflow-explorer",
}: DAGHeaderProps) {
  // Memoize stats to prevent recalculation on every render
  const stats = useMemo(() => {
    const groupCount = groups.length;
    const taskCount = groups.reduce((sum, g) => sum + (g.tasks?.length || 0), 0);
    return { groupCount, taskCount };
  }, [groups]);

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-400 hover:text-zinc-100"
          asChild
        >
          <a href={backUrl}>
            <ChevronLeft
              className="h-4 w-4 mr-1"
              aria-hidden="true"
            />
            Back
          </a>
        </Button>
        <div
          className="h-6 w-px bg-zinc-700"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">React Flow + ELK DAG</h1>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="text-emerald-400 flex items-center gap-1">
              {getStatusIcon(status, "h-3.5 w-3.5")}
              {status}
            </span>
            <span aria-hidden="true">•</span>
            <span>{stats.groupCount} groups</span>
            <span aria-hidden="true">•</span>
            <span>{stats.taskCount} tasks</span>
            <span aria-hidden="true">•</span>
            <span className="font-mono">{formatDuration(duration ?? null)}</span>
            {isLayouting && (
              <>
                <span aria-hidden="true">•</span>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-blue-400"
                  aria-label="Calculating layout"
                />
                {/* Live region for screen readers */}
                <span
                  className="sr-only"
                  role="status"
                  aria-live="polite"
                >
                  Calculating layout
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="View actions"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={onExpandAll}
        >
          <Maximize2
            className="h-4 w-4 mr-2"
            aria-hidden="true"
          />
          Expand All
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCollapseAll}
        >
          <Minimize2
            className="h-4 w-4 mr-2"
            aria-hidden="true"
          />
          Collapse All
        </Button>
        <Button
          variant="outline"
          size="sm"
        >
          <RefreshCw
            className="h-4 w-4 mr-2"
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>
    </header>
  );
}
