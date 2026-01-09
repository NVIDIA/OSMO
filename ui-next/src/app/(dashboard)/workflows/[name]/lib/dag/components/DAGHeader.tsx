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
 * DAGHeader Component
 *
 * Header bar for the DAG visualization page.
 * Displays workflow status, stats, and action buttons.
 */

"use client";

import { useMemo } from "react";
import { ChevronLeft, RefreshCw, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import type { GroupWithLayout } from "../workflow-types";
import { formatDuration } from "../workflow-types";
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
    <header className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          asChild
        >
          <a href={backUrl}>
            <ChevronLeft
              className="mr-1 h-4 w-4"
              aria-hidden="true"
            />
            Back
          </a>
        </Button>
        <div
          className="h-6 w-px bg-gray-300 dark:bg-zinc-700"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">React Flow + ELK DAG</h1>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
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
                  className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400"
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
            className="mr-2 h-4 w-4"
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
            className="mr-2 h-4 w-4"
            aria-hidden="true"
          />
          Collapse All
        </Button>
        <Button
          variant="outline"
          size="sm"
        >
          <RefreshCw
            className="mr-2 h-4 w-4"
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>
    </header>
  );
}
