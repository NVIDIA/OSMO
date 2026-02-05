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

/**
 * ContentSlideWrapper - Prevents reflow during panel snap animations.
 *
 * Strategy: Freeze-and-Clip (No Transform)
 * =========================================
 * Instead of animating content with transforms, we:
 * 1. Freeze content width at the LARGER of start/target when SNAPPING begins
 * 2. Let the grid container animate (it has `overflow: hidden`)
 * 3. Container clips frozen content naturally as it shrinks/grows
 * 4. Unfreeze when animation completes (IDLE phase)
 *
 * Why freeze at max(preSnap, target)?
 * - **Collapse (50% -> 2%)**: max(50%, 2%) = 50%. Content frozen at 600px, clips down.
 * - **Expand (2% -> 50%)**: max(2%, 50%) = 50%. Content frozen at 600px, reveals.
 *
 * This ensures:
 * - **Zero reflow**: Content never sees intermediate widths during animation
 * - **Bidirectional**: Same formula works for both collapse and expand
 * - **GPU-accelerated**: Grid's transition is partially GPU-accelerated
 *
 * Timing:
 * - preSnapWidthPct captured synchronously in state machine before phase changes
 * - snapTarget set simultaneously by state machine
 * - useLayoutEffect applies freeze synchronously before browser paint
 * - No "one frame of reflow" because width is captured before transition starts
 */

"use client";

import { useRef, useState, useLayoutEffect, useMemo, type ReactNode, type CSSProperties, type RefObject } from "react";
import { usePrevious } from "@react-hookz/web";
import type { ResizePhase } from "../../../lib/panel-resize-state-machine";

interface ContentSlideWrapperProps {
  /** Current resize phase from state machine */
  phase: ResizePhase;
  /** Width percentage captured BEFORE snap began (null when not snapping) */
  preSnapWidthPct: number | null;
  /** Target width percentage for snap animation (null when not snapping) */
  snapTarget: number | null;
  /** Container ref to measure pixel width */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Panel content to animate */
  children: ReactNode;
}

/**
 * Wraps panel content to prevent reflow during snap animations.
 * Freezes content at pre-snap width, lets container clip via overflow: hidden.
 */
export function ContentSlideWrapper({
  phase,
  preSnapWidthPct,
  snapTarget,
  containerRef,
  children,
}: ContentSlideWrapperProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const prevPhase = usePrevious(phase);
  const [frozenWidthPx, setFrozenWidthPx] = useState<number | null>(null);

  // Calculate the percentage to freeze at based on animation direction.
  // For smooth animations in both directions, freeze at the LARGER width:
  // - Collapse (50% -> 15%): Freeze at 50%, container shrinks and clips from right
  // - Expand (15% -> 50%): Freeze at 50%, container grows and reveals from left
  const frozenPct = useMemo(() => {
    if (preSnapWidthPct === null || snapTarget === null) {
      return null;
    }
    // Always freeze at the larger width for smooth animation in both directions
    return Math.max(preSnapWidthPct, snapTarget);
  }, [preSnapWidthPct, snapTarget]);

  // Freeze content width synchronously when snap animation begins
  useLayoutEffect(() => {
    const justStartedSnapping = prevPhase !== "SNAPPING" && phase === "SNAPPING";
    const justReturnedToIdle = prevPhase !== "IDLE" && phase === "IDLE";

    if (justStartedSnapping && frozenPct !== null) {
      // Calculate frozen width in pixels from computed freeze percentage
      const container = containerRef.current;
      if (container) {
        const containerWidth = container.offsetWidth;
        const frozenPx = (frozenPct / 100) * containerWidth;

        setFrozenWidthPx(frozenPx);
      }
    } else if (justReturnedToIdle) {
      // Animation complete: unfreeze content
      setFrozenWidthPx(null);
    }
  }, [phase, prevPhase, frozenPct, preSnapWidthPct, snapTarget, containerRef]);

  // Apply frozen width during SNAPPING phase
  const contentStyle: CSSProperties | undefined =
    frozenWidthPx !== null
      ? {
          width: `${frozenWidthPx}px`,
          minWidth: `${frozenWidthPx}px`, // Prevent shrinking below frozen width
          flexShrink: 0, // Don't let flex container compress us
        }
      : undefined;

  return (
    <div
      ref={contentRef}
      className="flex h-full min-w-0 flex-col overflow-hidden"
      style={contentStyle}
    >
      {children}
    </div>
  );
}
