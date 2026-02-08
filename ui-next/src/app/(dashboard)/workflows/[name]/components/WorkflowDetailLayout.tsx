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
 * WorkflowDetailLayout - CSS Grid layout with PanelResizeStateMachine integration.
 *
 * React controls all DOM state via CSS variables computed from the state machine.
 * Transition end events signal back to the machine to advance phases:
 * IDLE -> DRAGGING -> SNAPPING -> SETTLING -> IDLE
 */

"use client";

import { useRef, useMemo, useCallback, type ReactNode, type RefObject, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { FullSnapOverlay, StripSnapIndicator } from "@/app/(dashboard)/workflows/[name]/components/SnapZoneIndicator";
import {
  usePanelResize,
  useDisplayDagVisible,
  useIsDragging,
  useSnapZone,
} from "@/app/(dashboard)/workflows/[name]/lib/panel-resize-context";
import { PANEL_TIMING } from "@/app/(dashboard)/workflows/[name]/lib/panel-constants";

import "@/app/(dashboard)/workflows/[name]/styles/layout.css";

export interface WorkflowDetailLayoutProps {
  dagContent?: ReactNode;
  panel: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  mainAriaLabel?: string;
}

export function WorkflowDetailLayout({
  dagContent,
  panel,
  containerRef: externalContainerRef,
  mainAriaLabel,
}: WorkflowDetailLayoutProps) {
  // Get state machine state and actions
  const { phase, widthPct, onTransitionComplete } = usePanelResize();

  // Subscribe to specific state slices for rendering decisions
  const dagVisible = useDisplayDagVisible();
  const isDragging = useIsDragging();
  const snapZone = useSnapZone();

  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;

  // Compute CSS variables from state (React-controlled DOM)
  // Always use percentage-based grid tracks for smooth CSS transitions.
  // Mixed track types (e.g., "1fr 40px" to "50% 50%") cause browsers to fail interpolation.
  const gridStyle = useMemo((): CSSProperties => {
    const gridTemplateColumns = dagVisible ? `${100 - widthPct}% ${widthPct}%` : "0% 100%";

    return {
      gridTemplateColumns,
      transition: phase === "DRAGGING" ? "none" : `grid-template-columns ${PANEL_TIMING.TRANSITION_TIMING}`,
      willChange: phase === "SNAPPING" ? "grid-template-columns" : "auto",
      transform: phase === "DRAGGING" ? "translate3d(0, 0, 0)" : undefined,
    };
  }, [dagVisible, widthPct, phase]);

  // Handle CSS transition end - signal to state machine
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only handle grid-template-columns transitions on this element
      if (e.propertyName !== "grid-template-columns") return;
      if (e.target !== containerRef.current) return;

      // Only signal during SNAPPING phase
      if (phase === "SNAPPING") {
        onTransitionComplete();
      }
    },
    [phase, onTransitionComplete, containerRef],
  );

  // Derive visual states
  const showSnapIndicators = isDragging && dagVisible;
  const showFullSnapPreview = showSnapIndicators && snapZone === "full";
  const showStripSnapPreview = showSnapIndicators && snapZone === "strip";

  return (
    <div
      ref={containerRef}
      className={cn(
        // Grid layout - sizing controlled by React via style prop
        // overflow-hidden (not just overflow-y-hidden) prevents horizontal scrollbar
        // flash during snap animations. Sub-pixel rounding of percentage-based grid
        // columns can momentarily make the panel column < 40px, causing the 40px-wide
        // edge strip to overflow. Clipping both axes eliminates the transient scrollbar.
        "workflow-detail-grid grid h-full overflow-hidden",
        // Containment for performance
        "contain-layout-style",
        // Background
        "bg-gray-50 dark:bg-zinc-950",
      )}
      style={gridStyle}
      data-phase={phase}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* DAG Column - Grid handles sizing via React-controlled style.
          Always in the tree for stable React reconciliation. */}
      <main
        className={cn("relative overflow-hidden contain-style", !dagVisible && "min-w-0")}
        role="main"
        aria-label={mainAriaLabel ?? "Workflow DAG view"}
        aria-hidden={!dagVisible}
        data-dag-visible={dagVisible}
      >
        {dagVisible && (
          <>
            {dagContent}
            <FullSnapOverlay isActive={showFullSnapPreview} />
          </>
        )}
      </main>

      {/* Panel Column - always at same tree position for stable reconciliation */}
      {panel}

      <StripSnapIndicator
        isActive={showStripSnapPreview}
        containerRef={containerRef}
      />
    </div>
  );
}
