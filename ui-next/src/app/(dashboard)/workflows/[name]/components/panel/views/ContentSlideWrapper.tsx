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
 * Strategy: Direction-Aware Freeze
 * =================================
 * The animation direction determines the freeze strategy:
 *
 * **Collapse (preSnap > target) - Freeze-and-Clip:**
 * 1. Freeze content at the pre-snap width (the LARGER value)
 * 2. Grid container animates to smaller size with overflow: hidden
 * 3. Container clips frozen content from the right as it shrinks
 * 4. Content appears stationary while container slides over it
 *
 * **Expand (preSnap < target) - No Freeze:**
 * 1. Content uses width: 100%, naturally filling its container
 * 2. Grid container animates to larger size
 * 3. Content grows in lockstep with the container via CSS
 * 4. No gap between content edge and container edge at any frame
 *
 * Why different strategies per direction?
 * - Collapse: Freezing prevents costly intermediate relayouts as width shrinks.
 *   The overflow-hidden clip is seamless because content is wider than the viewport.
 * - Expand: Freezing at the TARGET width causes a mismatch. The frozen content is
 *   laid out at the full target width but only a portion is visible. The browser's
 *   CSS transition smoothly interpolates the grid columns, and the content tracks
 *   the container naturally via width: 100%. This eliminates the "catching up" glitch
 *   where content appeared smaller than the visible panel area during expansion.
 *
 * Performance:
 * - During expand, the browser handles intermediate layouts within the CSS transition.
 *   The content is inside `contain: layout style paint` which isolates reflow impact.
 * - React does NOT re-render during the CSS transition (it's pure CSS interpolation).
 * - The transition is 200ms - brief enough that intermediate relayouts are imperceptible.
 */

"use client";

import { useState, useLayoutEffect, type ReactNode, type CSSProperties, type RefObject } from "react";
import { usePrevious } from "@react-hookz/web";
import type { ResizePhase } from "@/app/(dashboard)/workflows/[name]/lib/panel-resize-state-machine";

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
 *
 * For collapse: freezes content at pre-snap width, lets container clip via overflow: hidden.
 * For expand: lets content flow naturally at 100% so it always fills the panel.
 */
export function ContentSlideWrapper({
  phase,
  preSnapWidthPct,
  snapTarget,
  containerRef,
  children,
}: ContentSlideWrapperProps) {
  const prevPhase = usePrevious(phase);

  // Frozen pixel width for collapse animations. Only set when collapsing
  // (requires DOM measurement via containerRef). Null otherwise.
  const [frozenWidthPx, setFrozenWidthPx] = useState<number | null>(null);

  // Detect animation direction from props. During SNAPPING phase, if the
  // target is larger than the starting width, the panel is expanding.
  // This is derived purely from props - no state needed.
  const isExpanding =
    phase === "SNAPPING" && preSnapWidthPct !== null && snapTarget !== null && snapTarget > preSnapWidthPct;

  // Freeze content width synchronously when a COLLAPSE snap animation begins.
  // For EXPAND animations, no freeze is needed - content flows naturally.
  // useLayoutEffect fires after DOM commit but before browser paint,
  // ensuring the freeze is visible in the very first animation frame.
  useLayoutEffect(() => {
    const justStartedSnapping = prevPhase !== "SNAPPING" && phase === "SNAPPING";
    const justReturnedToIdle = prevPhase !== "IDLE" && phase === "IDLE";

    if (justStartedSnapping && preSnapWidthPct !== null && snapTarget !== null) {
      const expanding = snapTarget > preSnapWidthPct;

      if (!expanding) {
        // COLLAPSE: Freeze content at the pre-snap (larger) width.
        // Measure the grid container to convert percentage to pixels.
        // The container shrinks around the frozen content, clipping from right.
        // This prevents expensive relayouts at intermediate widths.
        const container = containerRef.current;
        if (container) {
          const containerWidth = container.offsetWidth;
          const frozenPx = (preSnapWidthPct / 100) * containerWidth;
          setFrozenWidthPx(frozenPx);
        }
      }
      // EXPAND: No freeze needed. Content flows naturally at 100% of its
      // container. The CSS grid transition grows the panel column, and
      // content tracks it in lockstep. No gap between content and container.
    } else if (justReturnedToIdle) {
      // Animation complete: remove frozen width
      setFrozenWidthPx(null);
    }
  }, [phase, prevPhase, preSnapWidthPct, snapTarget, containerRef]);

  // Apply frozen width during COLLAPSE animations only.
  // During EXPAND, content has no explicit width and fills its container naturally.
  const contentStyle: CSSProperties | undefined =
    frozenWidthPx !== null && !isExpanding
      ? {
          width: `${frozenWidthPx}px`,
          minWidth: `${frozenWidthPx}px`, // Prevent flex shrinking below frozen width
          flexShrink: 0, // Don't let flex container compress us
        }
      : undefined;

  return (
    <div
      className="flex h-full w-full min-w-0 flex-col overflow-hidden"
      style={contentStyle}
    >
      {children}
    </div>
  );
}
