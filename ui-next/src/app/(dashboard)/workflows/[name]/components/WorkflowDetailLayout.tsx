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
 * WorkflowDetailLayout Component
 *
 * Unified layout container with smooth DAG slide animations.
 *
 * Architecture (Post-Simplification):
 * - Delayed unmount pattern: DAG stays mounted during exit animation
 * - Transform-based animations: GPU-accelerated slideX for 60fps
 * - Flexbox-based layout (NOT Grid) - ReactFlow compatible
 * - Panel owns drag state, layout just positions
 *
 * Performance:
 * - contain: layout style for reflow isolation
 * - GPU acceleration only during transitions (conditional will-change)
 * - Transitions disabled during drag via CSS
 */

"use client";

import { useState, useEffect, useRef, startTransition, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

// Animation constants
const DAG_TRANSITION_DURATION = 250; // ms (matches CSS)

// Types
export type LayoutMode = "sideBySide" | "panelOnly";
export type DAGState = "visible" | "exiting" | "hidden";

export interface WorkflowDetailLayoutProps {
  /** DAG content - managed with delayed unmount for smooth exit animation */
  dagContent?: ReactNode;

  /** Panel content - always rendered */
  panel: ReactNode;

  /** Whether DAG should be visible */
  dagVisible: boolean;

  /** Ref to container for resize calculations */
  containerRef?: RefObject<HTMLDivElement | null>;

  /** Accessible label for main content */
  mainAriaLabel?: string;

  /** Whether panel resize drag is active (disables transitions) */
  isDragging?: boolean;

  /** Whether a layout transition is in progress */
  isTransitioning?: boolean;
}

export function WorkflowDetailLayout({
  dagContent,
  panel,
  dagVisible,
  containerRef,
  mainAriaLabel,
  isDragging = false,
  isTransitioning: _isTransitioning = false,
}: WorkflowDetailLayoutProps) {
  // Track transition state for delayed unmount
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRenderDag, setShouldRenderDag] = useState(dagVisible);
  const dagRef = useRef<HTMLElement>(null);

  // Handle visibility changes with animation
  useEffect(() => {
    if (dagVisible) {
      // Show immediately, animation happens via CSS
      // Use startTransition for non-urgent state updates (React Compiler requirement)
      startTransition(() => {
        setShouldRenderDag(true);
      });
      // Small delay to ensure DOM is ready before animation starts
      requestAnimationFrame(() => {
        startTransition(() => {
          setIsAnimating(false);
        });
      });
    } else {
      // Start exit animation, delay unmount
      startTransition(() => {
        setIsAnimating(true);
      });
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

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full overflow-hidden", "contain-layout-style", "bg-gray-50 dark:bg-zinc-950")}
      data-layout-mode={layoutMode}
      data-dag-state={dagState}
      data-dragging={isDragging || undefined}
    >
      {/* DAG Area - always rendered during visible/exiting, hidden after animation */}
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
        </main>
      )}

      {/* Panel Area - always rendered, adapts to available space */}
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
    </div>
  );
}
