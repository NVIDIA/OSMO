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
 * WorkflowDetailLayout - Flexbox layout with GPU-accelerated DAG slide animations.
 * Uses delayed unmount pattern: DAG stays mounted during exit animation.
 */

"use client";

import { useState, useEffect, useRef, startTransition, type ReactNode, type RefObject } from "react";
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
  isTransitioning?: boolean;
  snapZone?: SnapZone | null;
  displayPct?: number;
}

export function WorkflowDetailLayout({
  dagContent,
  panel,
  dagVisible,
  containerRef: externalContainerRef,
  mainAriaLabel,
  isDragging = false,
  isTransitioning: _isTransitioning = false,
  snapZone = null,
  displayPct = 50,
}: WorkflowDetailLayoutProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRenderDag, setShouldRenderDag] = useState(dagVisible);
  const dagRef = useRef<HTMLElement>(null);
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;

  useEffect(() => {
    if (dagVisible) {
      startTransition(() => setShouldRenderDag(true));
      requestAnimationFrame(() => startTransition(() => setIsAnimating(false)));
    } else {
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

  const layoutMode: LayoutMode = dagVisible ? "sideBySide" : "panelOnly";
  const dagState: DAGState = dagVisible ? "visible" : isAnimating ? "exiting" : "hidden";
  const showSnapIndicators = isDragging && dagVisible;
  const showFullSnapPreview = showSnapIndicators && snapZone === "full";
  const showSoftSnapPreview = showSnapIndicators && snapZone === "soft";

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full overflow-y-hidden", "contain-layout-style", "bg-gray-50 dark:bg-zinc-950")}
      data-layout-mode={layoutMode}
      data-dag-state={dagState}
      data-dragging={isDragging || undefined}
    >
      {shouldRenderDag && (
        <main
          ref={dagRef}
          className="dag-slide-container relative min-w-0 flex-1 contain-style"
          role="main"
          aria-label={mainAriaLabel ?? "Workflow DAG view"}
          aria-hidden={!dagVisible}
          data-dag-visible={dagVisible}
        >
          {dagContent}
          <FullSnapOverlay isActive={showFullSnapPreview} />
        </main>
      )}

      {dagVisible || shouldRenderDag ? (
        panel
      ) : (
        <main
          className="relative min-w-0 flex-1"
          role="main"
          aria-label="Workflow details"
        >
          {panel}
        </main>
      )}

      <SoftSnapIndicator
        isActive={showSoftSnapPreview}
        currentPct={displayPct}
        containerRef={containerRef}
      />
    </div>
  );
}
