//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

"use client";

import * as React from "react";
import { memo, useState } from "react";
import { Button, buttonVariants } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { VariantProps } from "class-variance-authority";

/**
 * SemiStatefulButton - A button that shows current state, then transitions
 * to next state on hover/focus before committing on click.
 *
 * Design Philosophy:
 * - **Default**: Shows the current state (icon + tooltip)
 * - **Hover/Focus**: Transitions to next state (icon + tooltip)
 * - **Click**: Commits the transition
 *
 * Example: Currently showing "My Workflows" (User icon)
 * - Default: Shows User icon + "My Workflows" tooltip
 * - Hover: Shows Users icon + "Show All Workflows" tooltip
 * - Click: Switches to "All Workflows" state
 *
 * Use Cases:
 * - View toggles (My Workflows ↔ All Workflows)
 * - Display mode switches (Available ↔ Used)
 * - Layout toggles (Compact ↔ Comfortable)
 *
 * @example
 * ```tsx
 * <SemiStatefulButton
 *   onClick={toggleShowAllUsers}
 *   currentStateIcon={<User className="size-4" />}
 *   nextStateIcon={<Users className="size-4" />}
 *   currentStateLabel="My Workflows"
 *   nextStateLabel="Show All Workflows"
 *   aria-label="Toggle user filter"
 * />
 * ```
 */
export interface SemiStatefulButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children">, VariantProps<typeof buttonVariants> {
  /** Icon to show when in current state (default, not hovering) */
  currentStateIcon: React.ReactNode;
  /** Icon to show when hovering/focusing (preview of next state) */
  nextStateIcon: React.ReactNode;
  /** Tooltip label describing the current state */
  currentStateLabel: string;
  /** Tooltip label describing the action that will be taken (next state) */
  nextStateLabel: string;
  /** Tooltip side positioning */
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export const SemiStatefulButton = memo(function SemiStatefulButton({
  currentStateIcon,
  nextStateIcon,
  currentStateLabel,
  nextStateLabel,
  tooltipSide = "top",
  size = "sm",
  variant = "outline",
  className,
  onClick,
  ...buttonProps
}: SemiStatefulButtonProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Show next state when hovering or focused, otherwise show current state
  const showNextState = isHovering || isFocused;
  const displayIcon = showNextState ? nextStateIcon : currentStateIcon;
  const displayLabel = showNextState ? nextStateLabel : currentStateLabel;

  // Handle click: reset hover state to show new current state immediately
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setIsHovering(false);
    setIsFocused(false);
    onClick?.(e);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={size}
          variant={variant}
          className={className}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onClick={handleClick}
          {...buttonProps}
        >
          {displayIcon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{displayLabel}</TooltipContent>
    </Tooltip>
  );
});
