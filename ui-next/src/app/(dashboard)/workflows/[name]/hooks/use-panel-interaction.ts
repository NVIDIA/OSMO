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
 * Panel interaction hook for snap zone detection during resize.
 * Provides optimistic width during drag and coordinates DAG hide on full-width snap.
 */

"use client";

import { useState, useMemo, useRef } from "react";
import { useEventCallback } from "usehooks-ts";
import type { PanelPhase, SnapZone } from "../lib/panel-state-machine";
import { classifySnapZone, SNAP_ZONES } from "../lib/panel-state-machine";

interface UsePanelInteractionOptions {
  persistedPct: number;
  onPersist: (pct: number) => void;
  onHideDAG: () => void;
  /**
   * Function that returns current collapsed state.
   * Using a getter allows breaking circular dependencies between hooks.
   */
  getIsPanelCollapsed: () => boolean;
  /**
   * Function to expand the panel.
   * Called when drag starts while panel is collapsed.
   */
  onExpandPanel: () => void;
  /**
   * Called when grid transition completes (via transitionend event).
   * Used to update isCSSTransitioning state based on actual CSS completion.
   */
  onTransitionComplete?: () => void;
}

interface UsePanelInteractionReturn {
  displayPct: number;
  phase: PanelPhase;
  snapZone: SnapZone | null;
  isTransitioning: boolean;
  isDragging: boolean;
  dragHandlers: {
    onDragStart: () => void;
    onDrag: (pct: number) => void;
    onDragEnd: () => void;
  };
  /**
   * Called when a CSS transition starts (snap, collapse, expand).
   * Sets isTransitioning=true. Pair with onTransitionComplete.
   */
  onTransitionStart: () => void;
  /**
   * Called when grid transition completes (via transitionend event).
   * Sets isTransitioning=false.
   */
  onTransitionComplete: () => void;
}

export function usePanelInteraction(options: UsePanelInteractionOptions): UsePanelInteractionReturn {
  const { persistedPct, onPersist, onHideDAG, getIsPanelCollapsed, onExpandPanel } = options;

  // State + ref pattern: ref needed for synchronous access in callbacks
  // (useDrag may call onDragStart and onDrag in same event loop)
  const [phase, setPhase] = useState<PanelPhase>({ type: "idle" });
  const phaseRef = useRef<PanelPhase>(phase);

  // Track CSS transition state (grid has 200ms transition when not dragging)
  const [isCSSTransitioning, setIsCSSTransitioning] = useState(false);

  // Track pending snap action to execute when transition completes
  const pendingSnapActionRef = useRef<(() => void) | null>(null);

  const displayPct = useMemo(() => {
    if (phase.type === "dragging") return phase.currentPct;
    if (phase.type === "snapping") return phase.targetPct;
    return persistedPct;
  }, [phase, persistedPct]);

  const snapZone = useMemo((): SnapZone | null => {
    return phase.type === "dragging" ? classifySnapZone(phase.currentPct) : null;
  }, [phase]);

  const updatePhase = (newPhase: PanelPhase) => {
    phaseRef.current = newPhase;
    setPhase(newPhase);
  };

  const handleDragStart = useEventCallback((initialPct?: number) => {
    // Clear any pending snap action from previous interaction
    pendingSnapActionRef.current = null;

    if (getIsPanelCollapsed()) onExpandPanel();
    // Use provided initial percentage (for revealing from fullWidth) or persisted value
    const startPct = initialPct ?? persistedPct;
    updatePhase({ type: "dragging", startPct, currentPct: startPct, snapZone: null });
  });

  const handleDrag = useEventCallback((pct: number) => {
    const current = phaseRef.current;
    if (current.type !== "dragging") return;
    updatePhase({ type: "dragging", startPct: current.startPct, currentPct: pct, snapZone: classifySnapZone(pct) });
  });

  const handleDragEnd = useEventCallback(() => {
    const current = phaseRef.current;
    if (current.type !== "dragging") return;

    const zone = current.snapZone;
    if (zone === "full") {
      // Full-width snap: Transition to target, then hide DAG when transition completes
      setIsCSSTransitioning(true);
      updatePhase({ type: "snapping", targetPct: SNAP_ZONES.FULL_SNAP_TARGET, snapZone: "full" });
      pendingSnapActionRef.current = () => {
        updatePhase({ type: "idle" });
        onHideDAG();
      };
    } else if (zone === "soft") {
      // Soft snap to 80%: Persist target when transition completes
      setIsCSSTransitioning(true);
      updatePhase({ type: "snapping", targetPct: SNAP_ZONES.SOFT_SNAP_TARGET, snapZone: "soft" });
      pendingSnapActionRef.current = () => {
        onPersist(SNAP_ZONES.SOFT_SNAP_TARGET);
        updatePhase({ type: "idle" });
      };
    } else {
      // No snap: Grid doesn't change (was at currentPct, stays at currentPct),
      // so no CSS transition occurs. Phase transition to "idle" will trigger
      // column recalculation via the suspendResize effect in use-column-sizing.
      onPersist(current.currentPct);
      updatePhase({ type: "idle" });
    }
  });

  // Called when CSS transition starts (from layout component or collapse/expand toggle)
  const handleTransitionStart = useEventCallback(() => {
    setIsCSSTransitioning(true);
  });

  // Called when CSS transition completes (from transitionend event in layout component)
  const handleTransitionComplete = useEventCallback(() => {
    setIsCSSTransitioning(false);

    // Execute any pending snap action (e.g., onHideDAG, onPersist)
    if (pendingSnapActionRef.current) {
      pendingSnapActionRef.current();
      pendingSnapActionRef.current = null;
    }
  });

  return {
    displayPct,
    phase,
    snapZone,
    // isTransitioning now includes both state machine phase AND CSS transitions
    isTransitioning: phase.type !== "idle" || isCSSTransitioning,
    isDragging: phase.type === "dragging",
    dragHandlers: {
      onDragStart: handleDragStart,
      onDrag: handleDrag,
      onDragEnd: handleDragEnd,
    },
    onTransitionStart: handleTransitionStart,
    onTransitionComplete: handleTransitionComplete,
  };
}
