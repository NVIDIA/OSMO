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
  dagVisible: boolean;
  onHideDAG: () => void;
  isPanelCollapsed: boolean;
  onExpandPanel: () => void;
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
}

export function usePanelInteraction(options: UsePanelInteractionOptions): UsePanelInteractionReturn {
  const { persistedPct, onPersist, dagVisible: _dagVisible, onHideDAG, isPanelCollapsed, onExpandPanel } = options;

  // State + ref pattern: ref needed for synchronous access in callbacks
  // (useDrag may call onDragStart and onDrag in same event loop)
  const [phase, setPhase] = useState<PanelPhase>({ type: "idle" });
  const phaseRef = useRef<PanelPhase>(phase);

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
    if (isPanelCollapsed) onExpandPanel();
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
      updatePhase({ type: "snapping", targetPct: SNAP_ZONES.FULL_SNAP_TARGET, snapZone: "full" });
      setTimeout(() => {
        onHideDAG();
        onPersist(50);
        updatePhase({ type: "idle" });
      }, 250);
    } else if (zone === "soft") {
      updatePhase({ type: "snapping", targetPct: SNAP_ZONES.SOFT_SNAP_TARGET, snapZone: "soft" });
      setTimeout(() => {
        onPersist(SNAP_ZONES.SOFT_SNAP_TARGET);
        updatePhase({ type: "idle" });
      }, 250);
    } else {
      onPersist(current.currentPct);
      updatePhase({ type: "idle" });
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
