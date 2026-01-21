//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { memo } from "react";
import { Download, RefreshCcw, Tag, WrapText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";

// =============================================================================
// Types
// =============================================================================

export interface FooterProps {
  /** Whether line wrapping is enabled */
  wrapLines: boolean;
  /** Callback to toggle line wrapping */
  onToggleWrapLines: () => void;
  /** Whether task suffix is shown */
  showTask: boolean;
  /** Callback to toggle task suffix */
  onToggleShowTask: () => void;
  /** Callback to download logs */
  onDownload?: () => void;
  /** Callback to refresh logs */
  onRefresh?: () => void;
  /** Whether currently loading/refreshing */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function FooterInner({
  wrapLines,
  onToggleWrapLines,
  showTask,
  onToggleShowTask,
  onDownload,
  onRefresh,
  isLoading = false,
  className,
}: FooterProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 border-t px-3 py-2", className)}>
      {/* Left: Display options */}
      <div className="flex items-center gap-1">
        {/* Wrap lines toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={wrapLines ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onToggleWrapLines}
            >
              <WrapText className="size-4" />
              <span className="sr-only">{wrapLines ? "Disable" : "Enable"} line wrap</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{wrapLines ? "Disable" : "Enable"} line wrap</TooltipContent>
        </Tooltip>

        {/* Show task toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showTask ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onToggleShowTask}
            >
              <Tag className="size-4" />
              <span className="sr-only">{showTask ? "Hide" : "Show"} task</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{showTask ? "Hide" : "Show"} task</TooltipContent>
        </Tooltip>

        {/* Download button */}
        {onDownload && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDownload}
              >
                <Download className="size-4" />
                <span className="sr-only">Download logs</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Download logs</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Right: Refresh */}
      <div className="flex items-center gap-1">
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRefresh}
                disabled={isLoading}
              >
                <RefreshCcw className={cn("size-4", isLoading && "animate-spin")} />
                <span className="sr-only">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Refresh logs</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export const Footer = memo(FooterInner);
