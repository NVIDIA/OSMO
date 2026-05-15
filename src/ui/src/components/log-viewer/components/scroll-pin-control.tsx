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

import { memo } from "react";
import { ChevronsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";

// =============================================================================
// Types
// =============================================================================

export interface ScrollPinControlProps {
  /** Whether streaming is active (shows pin option when true) */
  isStreaming: boolean;
  /** Whether pinned to bottom (auto-scrolls on new entries) */
  isPinned: boolean;
  /** Callback to scroll to bottom immediately */
  onScrollToBottom: () => void;
  /** Callback to toggle pin state */
  onTogglePin: () => void;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function ScrollPinControlInner({
  isStreaming,
  isPinned,
  onScrollToBottom,
  onTogglePin,
  className,
}: ScrollPinControlProps) {
  // Combined action: scroll to bottom + toggle pin when streaming
  const handleClick = () => {
    onScrollToBottom();
    if (isStreaming) {
      onTogglePin();
    }
  };

  // Button is highlighted when actively pinned/tailing
  const isHighlighted = isStreaming && isPinned;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleClick}
          className={cn(
            isHighlighted
              ? "bg-foreground text-background hover:bg-foreground hover:text-background dark:hover:bg-foreground dark:hover:text-background"
              : "",
            className,
          )}
          aria-label={isHighlighted ? "Auto-following (click to disable)" : "Scroll to bottom"}
          aria-pressed={isHighlighted}
        >
          <ChevronsDown className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isHighlighted ? "Auto-following (click to disable)" : "Scroll to bottom"}
      </TooltipContent>
    </Tooltip>
  );
}

export const ScrollPinControl = memo(ScrollPinControlInner);
