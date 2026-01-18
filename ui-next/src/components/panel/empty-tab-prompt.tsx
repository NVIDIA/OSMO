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
 * EmptyTabPrompt - Generic empty state for tab content.
 *
 * Consolidates the pattern used by LogsTab, EventsTab across
 * WorkflowDetails and TaskDetails components.
 *
 * @example
 * ```tsx
 * <EmptyTabPrompt
 *   icon={FileText}
 *   title="Task Logs"
 *   description="View stdout/stderr output from the task execution"
 *   url={task.logs}
 *   buttonLabel="Open in New Tab"
 *   emptyText="No logs available"
 * />
 * ```
 */

"use client";

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/shadcn/button";

export interface EmptyTabPromptProps {
  /** Icon to display in the circular badge */
  icon: LucideIcon;
  /** Title text */
  title: string;
  /** Description text */
  description: string;
  /** Primary action URL (opens in new tab) */
  url?: string | null;
  /** Primary button label (default: "Open in New Tab") */
  buttonLabel?: string;
  /** Text to show when URL is not available */
  emptyText?: string;
  /** Secondary action (e.g., error logs link) */
  secondaryAction?: {
    url: string;
    label: string;
    icon?: LucideIcon;
    variant?: "destructive" | "outline";
  };
}

export const EmptyTabPrompt = memo(function EmptyTabPrompt({
  icon: Icon,
  title,
  description,
  url,
  buttonLabel = "Open in New Tab",
  emptyText = "Not available",
  secondaryAction,
}: EmptyTabPromptProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* Icon badge */}
      <div className="flex size-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
        <Icon className="size-6 text-gray-400 dark:text-zinc-500" />
      </div>

      {/* Title and description */}
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">{title}</h3>
        <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-zinc-400">{description}</p>
      </div>

      {/* Primary action or empty text */}
      {url ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          asChild
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon className="mr-1.5 size-3.5" />
            {buttonLabel}
          </a>
        </Button>
      ) : (
        <p className="text-xs text-gray-400 dark:text-zinc-500">{emptyText}</p>
      )}

      {/* Secondary action */}
      {secondaryAction && (
        <Button
          variant={secondaryAction.variant ?? "outline"}
          size="sm"
          className={
            secondaryAction.variant === "destructive"
              ? undefined
              : "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
          }
          asChild
        >
          <a
            href={secondaryAction.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {secondaryAction.icon && <secondaryAction.icon className="mr-1.5 size-3.5" />}
            {secondaryAction.label}
          </a>
        </Button>
      )}
    </div>
  );
});
