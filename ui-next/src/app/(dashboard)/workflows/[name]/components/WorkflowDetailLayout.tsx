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
 * Architecture:
 * - React controls ALL DOM state (no direct DOM manipulation)
 * - CSS variables computed from state machine
 * - Transition end events signal back to state machine
 * - Uses delayed unmount pattern for smooth DAG exit animation
 *
 * Phase Integration:
 * - IDLE: Normal state, transitions enabled
 * - DRAGGING: Transitions disabled for 60fps resize
 * - SNAPPING: Transition to snap target, waits for transitionend
 * - SETTLING: Double RAF before returning to IDLE
 */

"use client";

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  startTransition,
  type ReactNode,
  type RefObject,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";
import { FullSnapOverlay, StripSnapIndicator } from "./SnapZoneIndicator";
import { usePanelResize, useDisplayDagVisible, useIsDragging, useSnapZone } from "../lib/panel-resize-context";
import { PANEL_TIMING } from "../lib/panel-constants";

import "../styles/layout.css";

export type LayoutMode = "sideBySide" | "panelOnly";
type DAGState = "visible" | "exiting" | "hidden";

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

  // Internal state for delayed unmount pattern
  // dagRenderState tracks: "visible" | "exiting" | "hidden"
  // - "visible": DAG is shown, content mounted
  // - "exiting": DAG hiding, content still mounted for animation
  // - "hidden": DAG hidden, content unmounted
  const [dagRenderState, setDagRenderState] = useState<DAGState>(dagVisible ? "visible" : "hidden");
  const dagRef = useRef<HTMLElement>(null);
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;

  // Compute CSS variables from state (React-controlled DOM)
  const gridStyle = useMemo((): CSSProperties => {
    // Use percentage-based columns for smooth transitions
    // DAG width = 100 - panel width, Panel width = widthPct
    const dagWidthPct = 100 - widthPct;
    const columns = dagVisible ? `${dagWidthPct}% ${widthPct}%` : "0% 100%";

    // Disable transitions during drag for 60fps performance
    const transition = phase === "DRAGGING" ? "none" : `grid-template-columns ${PANEL_TIMING.TRANSITION_TIMING}`;

    return {
      gridTemplateColumns: columns,
      transition,
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

  // Delayed unmount pattern: keep DAG mounted during exit animation.
  useEffect(() => {
    if (dagVisible) {
      // DAG becoming visible: mount immediately
      startTransition(() => setDagRenderState("visible"));
    } else {
      // DAG hiding: start exit animation, then unmount after delay
      startTransition(() => setDagRenderState("exiting"));
      const timer = setTimeout(() => {
        startTransition(() => setDagRenderState("hidden"));
      }, PANEL_TIMING.DAG_TRANSITION_MS);
      return () => clearTimeout(timer);
    }
  }, [dagVisible]);

  // Derive visual states
  const layoutMode: LayoutMode = dagVisible ? "sideBySide" : "panelOnly";
  // Unmount React Flow immediately when hiding to avoid measurement warnings
  // Container still animates smoothly via grid transition
  const shouldRenderDag = dagVisible;
  const showSnapIndicators = isDragging && dagVisible;
  const showFullSnapPreview = showSnapIndicators && snapZone === "full";
  const showStripSnapPreview = showSnapIndicators && snapZone === "strip";

  return (
    <div
      ref={containerRef}
      className={cn(
        // Grid layout - sizing controlled by React via style prop
        "workflow-detail-grid grid h-full overflow-y-hidden",
        // Containment for performance
        "contain-layout-style",
        // Background
        "bg-gray-50 dark:bg-zinc-950",
      )}
      style={gridStyle}
      data-layout-mode={layoutMode}
      data-dag-state={dagRenderState}
      data-phase={phase}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* DAG Column - Grid handles sizing via React-controlled style.
          ALWAYS in the tree at this position for stable React reconciliation.
          When hidden: Grid column is 0fr, allowing graceful collapse. */}
      <main
        ref={dagRef}
        className={cn(
          "relative overflow-hidden contain-style",
          // When DAG hidden, min-w-0 allows grid to shrink column to 0
          !shouldRenderDag && "min-w-0",
        )}
        role="main"
        aria-label={mainAriaLabel ?? "Workflow DAG view"}
        aria-hidden={!dagVisible}
        data-dag-visible={dagVisible}
      >
        {/* Only render expensive content when needed */}
        {shouldRenderDag && (
          <>
            {dagContent}
            <FullSnapOverlay isActive={showFullSnapPreview} />
          </>
        )}
      </main>

      {/* Panel Column - Grid gives sizing via React-controlled style.
          ALWAYS at the same tree position for stable React reconciliation.
          SidePanel manages its own internal width constraints. */}
      {panel}

      <StripSnapIndicator
        isActive={showStripSnapPreview}
        containerRef={containerRef}
      />
    </div>
  );
}
