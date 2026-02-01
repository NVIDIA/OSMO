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
 * WorkflowDetailLayout - CSS Grid layout with deterministic column sizing.
 * Uses delayed unmount pattern: DAG stays mounted during exit animation.
 * Grid eliminates flexbox sibling competition for stable right-edge positioning.
 */

"use client";

import { useState, useEffect, useRef, startTransition, useMemo, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { FullSnapOverlay, SoftSnapIndicator } from "./SnapZoneIndicator";
import type { SnapZone } from "../lib/panel-state-machine";

const DAG_TRANSITION_DURATION = 250;

export type LayoutMode = "sideBySide" | "panelOnly";
type DAGState = "visible" | "exiting" | "hidden";

export interface WorkflowDetailLayoutProps {
  dagContent?: ReactNode;
  panel: ReactNode;
  dagVisible: boolean;
  containerRef?: RefObject<HTMLDivElement | null>;
  mainAriaLabel?: string;
  isDragging?: boolean;
  snapZone?: SnapZone | null;
  displayPct?: number;
  /** Called when grid-template-columns transition completes */
  onGridTransitionEnd?: () => void;
}

export function WorkflowDetailLayout({
  dagContent,
  panel,
  dagVisible,
  containerRef: externalContainerRef,
  mainAriaLabel,
  isDragging = false,
  snapZone = null,
  displayPct = 50,
  onGridTransitionEnd,
}: WorkflowDetailLayoutProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRenderDag, setShouldRenderDag] = useState(dagVisible);
  const dagRef = useRef<HTMLElement>(null);
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;

  // Listen for grid-template-columns transition completion
  useEffect(() => {
    const grid = containerRef.current;
    if (!grid || !onGridTransitionEnd) return;

    const handleTransitionEnd = (e: TransitionEvent) => {
      // Only handle grid-template-columns transitions on this element
      if (e.propertyName === "grid-template-columns" && e.target === grid) {
        onGridTransitionEnd();
      }
    };

    grid.addEventListener("transitionend", handleTransitionEnd);
    return () => grid.removeEventListener("transitionend", handleTransitionEnd);
  }, [containerRef, onGridTransitionEnd]);

  // Delayed unmount pattern: keep DAG mounted during exit animation.
  // The parent passes `dagVisible` which already accounts for reveal-via-drag
  // (computed from displayPct < 100 during drag), so we just respond to that prop.
  useEffect(() => {
    if (dagVisible) {
      // DAG becoming visible: mount immediately, clear animation state
      startTransition(() => setShouldRenderDag(true));
      requestAnimationFrame(() => startTransition(() => setIsAnimating(false)));
    } else {
      // DAG hiding: start exit animation, unmount after delay
      startTransition(() => setIsAnimating(true));
      const timer = setTimeout(() => {
        startTransition(() => {
          setShouldRenderDag(false);
          setIsAnimating(false);
        });
      }, DAG_TRANSITION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [dagVisible]);

  // Derive visual states
  const layoutMode: LayoutMode = dagVisible ? "sideBySide" : "panelOnly";
  const dagState: DAGState = dagVisible ? "visible" : isAnimating ? "exiting" : "hidden";
  const showSnapIndicators = isDragging && dagVisible;
  const showFullSnapPreview = showSnapIndicators && snapZone === "full";
  const showSoftSnapPreview = showSnapIndicators && snapZone === "soft";

  // Grid column template - deterministic sizing eliminates flexbox competition.
  // Uses dagVisible (which parent computes from displayPct during drag) for grid behavior.
  // This ensures the grid responds to displayPct < 100 to reveal the DAG column progressively.
  const gridTemplateColumns = useMemo(() => {
    if (!dagVisible) {
      // DAG hidden: collapse first column to 0fr, panel takes all space (1fr)
      return "0fr 1fr";
    }
    // DAG visible: DAG takes remaining space (minmax allows shrink to 0), panel has explicit percentage
    return `minmax(0, 1fr) ${displayPct}%`;
  }, [dagVisible, displayPct]);

  return (
    <div
      ref={containerRef}
      className={cn(
        // Grid layout (replaces flex) - explicit column sizing eliminates sibling competition
        "grid h-full overflow-y-hidden",
        // Containment for performance
        "contain-layout-style",
        // Background
        "bg-gray-50 dark:bg-zinc-950",
        // Transitions: disable during drag for 60fps, enable otherwise for smooth snap
        isDragging ? "transition-none" : "transition-[grid-template-columns] duration-200 ease-out",
      )}
      style={{ gridTemplateColumns }}
      data-layout-mode={layoutMode}
      data-dag-state={dagState}
      data-dragging={isDragging || undefined}
    >
      {/* DAG Column - Grid handles sizing via grid-template-columns.
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

      {/* Panel Column - Grid gives explicit percentage sizing.
          ALWAYS at the same tree position for stable React reconciliation.
          SidePanel manages its own internal width constraints. */}
      {panel}

      <SoftSnapIndicator
        isActive={showSoftSnapPreview}
        currentPct={displayPct}
        containerRef={containerRef}
      />
    </div>
  );
}
