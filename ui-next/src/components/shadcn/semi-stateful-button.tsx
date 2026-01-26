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
import { memo, useState, useCallback } from "react";
import { Button, buttonVariants } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { VariantProps } from "class-variance-authority";

/**
 * SemiStatefulButton - A button that shows current state, then transitions
 * to next state on hover/focus before committing on click.
 *
 * Design Philosophy:
 * - **Default**: Shows the current state icon (no tooltip)
 * - **Hover/Focus**: Transitions to next state icon + shows tooltip with action label
 * - **Click**: Commits the transition
 *
 * Example: Currently showing "My Workflows" (User icon)
 * - Default: Shows User icon (no tooltip)
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
 *   label="Show All Workflows"
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
  /** Tooltip label describing the action that will be taken (shown on hover only) */
  label: string;
  /** Tooltip side positioning */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /**
   * Optional: Explicitly control transition state for async operations.
   * When true, hover state is ignored to prevent flip-flopping during async updates.
   * Use this for toggles that update async state (nuqs, API calls, etc).
   */
  isTransitioning?: boolean;
}

export const SemiStatefulButton = memo(function SemiStatefulButton({
  currentStateIcon,
  nextStateIcon,
  label,
  tooltipSide = "top",
  size = "sm",
  variant = "outline",
  className,
  onClick,
  isTransitioning: externalIsTransitioning,
  ...buttonProps
}: SemiStatefulButtonProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Store the icon value when user clicks to track transition completion
  // When currentStateIcon changes from this value, the transition is complete
  const [transitionStartIcon, setTransitionStartIcon] = useState<React.ReactNode>(null);

  // Derive whether we're in a click transition period
  // We're in transition if we stored an icon AND it still matches the current icon
  // Once currentStateIcon changes, the parent state has updated and transition is complete
  const internalIsTransitioning = transitionStartIcon !== null && transitionStartIcon === currentStateIcon;

  // Use external transition state if provided (for async operations), otherwise use internal detection
  const isClickTransition = externalIsTransitioning ?? internalIsTransitioning;

  // Show next state only if hovering/focused AND not in click transition
  const showNextState = (isHovering || isFocused) && !isClickTransition;
  const displayIcon = showNextState ? nextStateIcon : currentStateIcon;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Store current icon to track when it changes (indicating parent state updated)
      // Only do this if not using external transition control
      if (externalIsTransitioning === undefined) {
        setTransitionStartIcon(currentStateIcon);
      }
      // Reset local state
      setIsHovering(false);
      setIsFocused(false);
      onClick?.(e);
    },
    [currentStateIcon, onClick, externalIsTransitioning],
  );

  const handleMouseEnter = useCallback(() => {
    // Only update hover if not in click transition
    if (!isClickTransition) {
      setIsHovering(true);
    }
  }, [isClickTransition]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    // Mouse left - safe to end transition by clearing the stored icon
    // Only if not using external transition control
    if (externalIsTransitioning === undefined) {
      setTransitionStartIcon(null);
    }
  }, [externalIsTransitioning]);

  const handleFocus = useCallback(() => {
    if (!isClickTransition) {
      setIsFocused(true);
    }
  }, [isClickTransition]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Only clear internal transition state if not using external control
    if (externalIsTransitioning === undefined) {
      setTransitionStartIcon(null);
    }
  }, [externalIsTransitioning]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={size}
          variant={variant}
          className={className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={handleClick}
          {...buttonProps}
        >
          {displayIcon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
});
