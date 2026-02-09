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

import { useRef, useState, useCallback, useEffect, type RefObject } from "react";
import { useRafCallback } from "@react-hookz/web";

// =============================================================================
// Types
// =============================================================================

/**
 * Panel animation phases (4-state machine with two-phase mounting):
 *
 * OPEN sequence:  closed -> opening -> open
 *   1. `open` prop becomes true
 *   2. Phase = "opening": Panel shell mounts and slides in (translateX 100% -> 0).
 *      Content is NOT yet mounted - panel slides in empty.
 *   3. After one RAF (one paint frame), content mounts and plays enter animation.
 *   4. Content animationend fires -> enterComplete -> phase = "open"
 *
 * CLOSE sequence: open -> closing -> closed
 *   1. `open` prop becomes false
 *   2. Phase = "closing": Panel slides out via CSS transition on transform.
 *      Content stays visible and mounted, riding along inside the panel
 *      as one visual unit.
 *   3. Panel transitionend fires -> slideOutComplete -> phase = "closed",
 *      content unmounts.
 *
 * The asymmetry prevents the "GPU transform storm":
 * - Open: Panel slides first (empty GPU layer), then content mounts (layout isolated)
 * - Close: Panel + content slide together (no new layout, safe to ride along)
 */
export type AnimationPhase = "closed" | "opening" | "open" | "closing";

/**
 * Content visibility states driven by CSS data-content-state attribute.
 * See resizable-panel.css for the corresponding styles/keyframes.
 *
 * Only "entering" has an animation. The other states are static.
 *
 * Internal to this hook - not exported (context only exposes `phase`).
 */
type ContentState = "hidden" | "entering" | "visible";

export interface UsePanelAnimationReturn {
  /** Current animation phase */
  phase: AnimationPhase;
  /** Whether the panel shell should be mounted in the DOM */
  shellMounted: boolean;
  /** Whether the content (children) should be mounted in the DOM */
  contentMounted: boolean;
  /** Whether the panel should be at translateX(0) vs translateX(100%) */
  panelSlideIn: boolean;
  /** Content state for the data-content-state CSS attribute */
  contentState: ContentState;
  /** Ref to attach to the content wrapper element */
  contentRef: RefObject<HTMLDivElement | null>;
  /** onAnimationEnd handler for the content wrapper (handles enter completion) */
  handleContentAnimationEnd: (e: React.AnimationEvent) => void;
  /** onTransitionEnd handler for the panel aside (handles slide-out completion) */
  handlePanelTransitionEnd: (e: React.TransitionEvent) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function getContentState(phase: AnimationPhase, contentMounted: boolean): ContentState {
  if (!contentMounted) return "hidden";

  switch (phase) {
    case "closed":
      return "hidden";
    case "opening":
      // Content mounts during opening (after RAF), starts entering animation
      return "entering";
    case "open":
    case "closing":
      // Content stays fully visible during close - it rides with the panel
      return "visible";
  }
}

/**
 * SSR-safe check for prefers-reduced-motion.
 */
function getPrefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Manages the ResizablePanel animation state machine with RAF-based deferred content mounting.
 *
 * Key design:
 * - Shell mounts immediately when opening (GPU layer established)
 * - Content mounts ONE FRAME later via RAF (prevents transform storm)
 * - Content unmounts after panel fully slides out when closing
 *
 * React Compiler compatibility:
 * - Uses setState in RAF callback (not in useEffect body)
 * - Prop-change detection via state (derive state from props pattern)
 * - All other state transitions in event handlers
 */
export function usePanelAnimation(open: boolean, onClosed?: () => void): UsePanelAnimationReturn {
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [enterComplete, setEnterComplete] = useState(false);
  const [slideOutComplete, setSlideOutComplete] = useState(true);
  const [contentReady, setContentReady] = useState(false);
  const [prevOpen, setPrevOpen] = useState<boolean | undefined>(undefined);

  const openChanged = prevOpen !== open;
  const isInitialRender = prevOpen === undefined;
  const justOpened = openChanged && (isInitialRender ? open : prevOpen === false && open === true);
  const justClosed = openChanged && !isInitialRender && prevOpen === true && open === false;

  const [scheduleContentMount] = useRafCallback(() => {
    setContentReady(true);
  });

  // React's useState bails out on identical values, so we can set directly without guards
  if (openChanged) {
    setPrevOpen(open);

    if (justOpened) {
      setContentReady(false); // Will be set via RAF after shell mounts
      setSlideOutComplete(false);

      if (getPrefersReducedMotion()) {
        setEnterComplete(true);
        setContentReady(true);
      } else {
        setEnterComplete(false);
      }
    }

    if (justClosed) {
      setEnterComplete(false);

      if (getPrefersReducedMotion()) {
        setSlideOutComplete(true);
        setContentReady(false);
      } else {
        setSlideOutComplete(false);
      }
    }
  }

  // Schedule content mount via RAF when opening (after shell is painted)
  useEffect(() => {
    if (open && !contentReady && !getPrefersReducedMotion()) {
      scheduleContentMount();
    }
  }, [open, contentReady, scheduleContentMount]);

  let phase: AnimationPhase;
  if (open) {
    phase = enterComplete ? "open" : "opening";
  } else {
    phase = slideOutComplete ? "closed" : "closing";
  }

  const shellMounted = phase !== "closed";
  const contentMounted = shellMounted && contentReady;
  const panelSlideIn = phase === "opening" || phase === "open";

  const contentState = getContentState(phase, contentMounted);

  // Handle content enter animation completion
  const handleContentAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      if (e.target !== contentRef.current) return;
      if (open) {
        setEnterComplete(true);
      }
    },
    [open],
  );

  // Handle panel slide-out transition completion
  const handlePanelTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only respond to the panel's own transform transition
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "transform") return;

      if (!open) {
        // Close sequence complete: mark slide-out done and unmount content
        // (In reduced-motion mode, these are set immediately in the render-phase block)
        setSlideOutComplete(true);
        setContentReady(false);

        // Notify parent that close animation is complete
        onClosed?.();
      }
    },
    [open, onClosed],
  );

  return {
    phase,
    shellMounted,
    contentMounted,
    panelSlideIn,
    contentState,
    contentRef,
    handleContentAnimationEnd,
    handlePanelTransitionEnd,
  };
}
