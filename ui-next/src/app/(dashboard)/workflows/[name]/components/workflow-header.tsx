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
 * WorkflowHeader Component
 *
 * Header bar for the workflow detail page.
 * Displays:
 * - Back navigation to workflows list
 * - Workflow name
 * - Status badge
 * - Duration (live timer for running workflows)
 * - Action buttons (Cancel, Logs, etc.)
 */

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, XCircle, FileText, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import type { WorkflowQueryResponse } from "@/lib/api/generated";
import { formatDuration } from "@/app/(dashboard)/dev/workflow-explorer/workflow-types";
import { getStatusIcon } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/utils/status";
import { STATUS_STYLES, STATUS_CATEGORY_MAP } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/constants";

// =============================================================================
// Types
// =============================================================================

interface WorkflowHeaderProps {
  /** The workflow data */
  workflow: WorkflowQueryResponse;
  /** Whether data is being refreshed */
  isRefreshing?: boolean;
  /** Callback when user clicks refresh */
  onRefresh?: () => void;
  /** Callback when user clicks cancel */
  onCancel?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowHeader({ workflow, isRefreshing, onRefresh, onCancel }: WorkflowHeaderProps) {
  // Get status category for styling
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "unknown";
  const statusStyles = STATUS_STYLES[statusCategory];

  // Calculate duration
  const duration = useMemo(() => {
    if (workflow.duration) return workflow.duration;
    if (workflow.start_time) {
      const start = new Date(workflow.start_time).getTime();
      const end = workflow.end_time ? new Date(workflow.end_time).getTime() : Date.now();
      return (end - start) / 1000;
    }
    return null;
  }, [workflow.duration, workflow.start_time, workflow.end_time]);

  // Determine if workflow can be cancelled
  const canCancel = statusCategory === "running" || statusCategory === "waiting";

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      {/* Left side: Back button, name, status */}
      <div className="flex items-center gap-4">
        {/* Back to workflows list */}
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          asChild
        >
          <Link href="/workflows">
            <ChevronLeft
              className="mr-1 h-4 w-4"
              aria-hidden="true"
            />
            Workflows
          </Link>
        </Button>

        <div
          className="h-6 w-px bg-gray-300 dark:bg-zinc-700"
          aria-hidden="true"
        />

        {/* Workflow name and status */}
        <div>
          <h1 className="font-mono text-lg font-semibold text-gray-900 dark:text-zinc-100">{workflow.name}</h1>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-400">
            {/* Status badge */}
            <span className={`flex items-center gap-1 ${statusStyles.text}`}>
              {getStatusIcon(workflow.status, "h-3.5 w-3.5")}
              {workflow.status}
            </span>

            {/* Duration */}
            {duration !== null && (
              <>
                <span aria-hidden="true">•</span>
                <span className="font-mono">{formatDuration(duration)}</span>
              </>
            )}

            {/* User */}
            {workflow.user && (
              <>
                <span aria-hidden="true">•</span>
                <span>by {workflow.user}</span>
              </>
            )}

            {/* Pool */}
            {workflow.pool && (
              <>
                <span aria-hidden="true">•</span>
                <span>{workflow.pool}</span>
              </>
            )}

            {/* Refreshing indicator */}
            {isRefreshing && (
              <>
                <span aria-hidden="true">•</span>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400"
                  aria-label="Refreshing"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Actions */}
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Workflow actions"
      >
        {/* Logs button */}
        {workflow.logs && (
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href={workflow.logs}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText
                className="mr-2 h-4 w-4"
                aria-hidden="true"
              />
              Logs
              <ExternalLink
                className="ml-1 h-3 w-3 opacity-50"
                aria-hidden="true"
              />
            </a>
          </Button>
        )}

        {/* Dashboard button */}
        {workflow.dashboard_url && (
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href={workflow.dashboard_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Dashboard
              <ExternalLink
                className="ml-1 h-3 w-3 opacity-50"
                aria-hidden="true"
              />
            </a>
          </Button>
        )}

        {/* Refresh button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>

        {/* Cancel button */}
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
          >
            <XCircle
              className="mr-2 h-4 w-4"
              aria-hidden="true"
            />
            Cancel
          </Button>
        )}
      </div>
    </header>
  );
}
