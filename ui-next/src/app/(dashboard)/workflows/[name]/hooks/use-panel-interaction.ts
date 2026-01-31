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
 * Panel interaction hook for snap zone detection and drag coordination.
 *
 * Simplified scope (post-622-line-reduction):
 * - Manages snap zone detection during panel resize
 * - Provides optimistic width during drag (not persisted until release)
 * - Coordinates DAG hide transition when snapping to full-width
 */

"use client";

import { useState, useMemo } from "react";
import { useEventCallback } from "usehooks-ts";
import type { PanelPhase, SnapZone } from "../lib/panel-state-machine";
import { classifySnapZone, SNAP_ZONES } from "../lib/panel-state-machine";

interface UsePanelInteractionOptions {
  /** Current persisted panel width percentage */
  persistedPct: number;
  /** Callback to persist width to Zustand store */
  onPersist: (pct: number) => void;
  /** Whether DAG is currently visible */
  dagVisible: boolean;
  /** Callback to hide DAG (for full-width snap) */
  onHideDAG: () => void;
  /** Whether panel is collapsed */
  isPanelCollapsed: boolean;
  /** Callback to expand panel (when dragging from collapsed state) */
  onExpandPanel: () => void;
}

interface UsePanelInteractionReturn {
  /** Current display width (optimistic during drag, persisted otherwise) */
  displayPct: number;
  /** Current phase for animations */
  phase: PanelPhase;
  /** Active snap zone for visual feedback */
  snapZone: SnapZone | null;
  /** Whether currently in any transition */
  isTransitioning: boolean;
  /** Whether drag is active (for tick controller suppression) */
  isDragging: boolean;
  /** Drag handlers for integration with SidePanel */
  dragHandlers: {
    onDragStart: () => void;
    onDrag: (pct: number) => void;
    onDragEnd: () => void;
  };
}

export function usePanelInteraction(options: UsePanelInteractionOptions): UsePanelInteractionReturn {
  const { persistedPct, onPersist, dagVisible: _dagVisible, onHideDAG, isPanelCollapsed, onExpandPanel } = options;

  // State machine
  const [phase, setPhase] = useState<PanelPhase>({ type: "idle" });

  // Compute display width (optimistic during drag, persisted otherwise)
  const displayPct = useMemo(() => {
    if (phase.type === "dragging") return phase.currentPct;
    if (phase.type === "snapping") return phase.targetPct;
    return persistedPct;
  }, [phase, persistedPct]);

  // Compute snap zone from current width
  const snapZone = useMemo((): SnapZone | null => {
    if (phase.type !== "dragging") return null;
    return classifySnapZone(phase.currentPct);
  }, [phase]);

  // Drag handlers
  const handleDragStart = useEventCallback(() => {
    // If collapsed, first expand before allowing drag
    if (isPanelCollapsed) {
      onExpandPanel();
    }
    setPhase({ type: "dragging", startPct: persistedPct, currentPct: persistedPct, snapZone: null });
  });

  const handleDrag = useEventCallback((pct: number) => {
    if (phase.type !== "dragging") return;
    const zone = classifySnapZone(pct);
    setPhase({ type: "dragging", startPct: phase.startPct, currentPct: pct, snapZone: zone });
  });

  const handleDragEnd = useEventCallback(() => {
    if (phase.type !== "dragging") return;

    const zone = phase.snapZone;
    if (zone === "full") {
      // Snap to full width: animate to 100%, then hide DAG
      setPhase({ type: "snapping", targetPct: SNAP_ZONES.FULL_SNAP_TARGET, snapZone: "full" });
      // Sequence: snap completes → hide DAG → reset to 50% for next enable
      setTimeout(() => {
        onHideDAG();
        onPersist(50); // Reset to 50% for when DAG is re-enabled
        setPhase({ type: "idle" });
      }, 250); // Match transition duration
    } else if (zone === "soft") {
      // Snap to 80%: animate to target, then persist
      setPhase({ type: "snapping", targetPct: SNAP_ZONES.SOFT_SNAP_TARGET, snapZone: "soft" });
      setTimeout(() => {
        onPersist(SNAP_ZONES.SOFT_SNAP_TARGET);
        setPhase({ type: "idle" });
      }, 250); // Match transition duration
    } else {
      // Normal release: persist current width
      onPersist(phase.currentPct);
      setPhase({ type: "idle" });
    }
  });

  return {
    displayPct,
    phase,
    snapZone,
    isTransitioning: phase.type !== "idle",
    isDragging: phase.type === "dragging",
    dragHandlers: {
      onDragStart: handleDragStart,
      onDrag: handleDrag,
      onDragEnd: handleDragEnd,
    },
  };
}
