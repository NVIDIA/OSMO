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
 * PanelCollapsedStrip - Generic collapsed state content for ResizablePanel.
 *
 * Provides a standard expand button at the top with a slot for domain-specific
 * quick actions. Used when collapsible mode is enabled on ResizablePanel.
 */

"use client";

import { memo, useRef, useCallback } from "react";
import { ArrowLeftFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/shadcn/tooltip";

// =============================================================================
// Types
// =============================================================================

export interface PanelCollapsedStripProps {
  /** Callback to expand the panel */
  onExpand: () => void;
  /** Optional content slot for domain-specific quick links/actions */
  children?: React.ReactNode;
  /** Additional className */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Generic collapsed strip with expand button and content slot.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <PanelCollapsedStrip onExpand={toggleCollapsed} />
 *
 * // With domain-specific quick links
 * <PanelCollapsedStrip onExpand={toggleCollapsed}>
 *   <div className="my-3 h-px w-5 bg-zinc-200 dark:bg-zinc-700" />
 *   <QuickLinks items={links} />
 * </PanelCollapsedStrip>
 * ```
 */
export const PanelCollapsedStrip = memo(function PanelCollapsedStrip({
  onExpand,
  children,
  className,
}: PanelCollapsedStripProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Handle keyboard navigation: Enter expands the panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onExpand();
      }
    },
    [onExpand],
  );

  return (
    <div className={cn("relative flex h-full w-full flex-col items-center py-3", className)}>
      {/* Expand button at top */}
      {/* TooltipProvider with delay to prevent jarring flash on programmatic focus */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={buttonRef}
              type="button"
              onClick={onExpand}
              onKeyDown={handleKeyDown}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg",
                "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                "transition-colors",
                // Focus-visible styling with clear selection treatment
                "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                "focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900",
                "focus-visible:outline-none",
                "focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800",
              )}
              aria-label="Expand panel (Enter)"
            >
              <ArrowLeftFromLine
                className="size-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Expand panel (Enter)</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Domain-specific content slot */}
      {children}
    </div>
  );
});
