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
import { Download, ExternalLink, Tag, WrapText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { ScrollPinControl } from "@/components/log-viewer/components/ScrollPinControl";

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
  /** Callback to toggle task suffix (hidden when undefined, e.g., task scope) */
  onToggleShowTask?: () => void;
  /** URL to open raw logs in new tab (direct to backend) */
  externalLogUrl?: string;
  /** Callback to download logs */
  onDownload?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether streaming is active (shows pin option when true) */
  isStreaming?: boolean;
  /** Whether pinned to bottom (auto-scrolls on new entries) */
  isPinnedToBottom?: boolean;
  /** Callback to scroll to bottom immediately */
  onScrollToBottom?: () => void;
  /** Callback to toggle pin state */
  onTogglePinnedToBottom?: () => void;
}

// =============================================================================
// Component
// =============================================================================

function FooterInner({
  wrapLines,
  onToggleWrapLines,
  showTask,
  onToggleShowTask,
  externalLogUrl,
  onDownload,
  className,
  isStreaming = false,
  isPinnedToBottom = false,
  onScrollToBottom,
  onTogglePinnedToBottom,
}: FooterProps) {
  return (
    <div className={cn("border-input shrink-0 border-t px-3 py-2", className)}>
      <div className="flex items-center justify-end text-xs">
        {/* Right-aligned controls in order: scroll, task, wrap, download, new tab */}
        <div className="flex items-center gap-2">
          {/* Scroll/Pin controls */}
          {onScrollToBottom && onTogglePinnedToBottom && (
            <ScrollPinControl
              isStreaming={isStreaming}
              isPinned={isPinnedToBottom}
              onScrollToBottom={onScrollToBottom}
              onTogglePin={onTogglePinnedToBottom}
            />
          )}

          {/* Show task toggle (hidden when scoped to a single task) */}
          {onToggleShowTask && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleShowTask}
                  className={cn(
                    "rounded p-1 transition-colors",
                    showTask ? "bg-foreground text-background" : "hover:bg-accent",
                  )}
                >
                  <Tag className="size-4" />
                  <span className="sr-only">{showTask ? "Hide" : "Show"} task</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{showTask ? "Hide" : "Show"} task</TooltipContent>
            </Tooltip>
          )}

          {/* Wrap lines toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleWrapLines}
                className={cn(
                  "rounded p-1 transition-colors",
                  wrapLines ? "bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                <WrapText className="size-4" />
                <span className="sr-only">{wrapLines ? "Disable" : "Enable"} line wrap</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{wrapLines ? "Disable" : "Enable"} line wrap</TooltipContent>
          </Tooltip>

          {/* Download button */}
          {onDownload && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onDownload}
                  className="hover:bg-accent rounded p-1"
                >
                  <Download className="size-4" />
                  <span className="sr-only">Download logs</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Download logs</TooltipContent>
            </Tooltip>
          )}

          {/* External link - opens raw logs in new tab */}
          {externalLogUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={externalLogUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:bg-accent rounded p-1"
                >
                  <ExternalLink className="size-4" />
                  <span className="sr-only">Open raw logs in new tab</span>
                </a>
              </TooltipTrigger>
              <TooltipContent side="top">Open raw logs in new tab</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

export const Footer = memo(FooterInner);
