//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * WorkflowDetailLayout Component
 *
 * Unified layout container for workflow detail views using Flexbox.
 * Provides consistent two-column layout with smooth panel transitions.
 *
 * Architecture:
 * - Flexbox-based (NOT Grid) - proven pattern, ReactFlow compatible
 * - Slot-based composition: children (main content) + panel
 * - CSS containment: layout style (NOT strict)
 * - Panel owns drag state, layout just positions
 *
 * Performance:
 * - contain: layout style for reflow isolation
 * - Transitions disabled during drag via CSS class
 * - No unnecessary re-renders of children (memoized slots)
 */

"use client";

import { type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

// Types
export type LayoutMode = "sideBySide" | "panelOnly";

export interface WorkflowDetailLayoutProps {
  /** DAG content - only rendered when dagVisible */
  dagContent?: ReactNode;

  /** Panel content - always rendered */
  panel: ReactNode;

  /** Whether DAG is visible */
  dagVisible: boolean;

  /** Panel width as percentage (20-80, used when dagVisible) */
  panelWidthPct: number;

  /** Whether panel is collapsed to edge strip */
  isPanelCollapsed: boolean;

  /** Ref to container for resize calculations */
  containerRef?: RefObject<HTMLDivElement | null>;

  /** Accessible label for main content */
  mainAriaLabel?: string;
}

// Component (DO NOT wrap in memo() - must update on panelWidthPct change)
export function WorkflowDetailLayout({
  dagContent,
  panel,
  dagVisible,
  panelWidthPct: _panelWidthPct,
  isPanelCollapsed: _isPanelCollapsed,
  containerRef,
  mainAriaLabel,
}: WorkflowDetailLayoutProps) {
  const layoutMode: LayoutMode = dagVisible ? "sideBySide" : "panelOnly";

  return (
    <div
      ref={containerRef}
      className={cn(
        // Flexbox two-column layout (NOT Grid per consensus)
        "flex h-full overflow-hidden",
        // CSS containment: layout style (NOT strict per consensus)
        "contain-layout-style",
        // Background
        "bg-gray-50 dark:bg-zinc-950",
      )}
      data-layout-mode={layoutMode}
    >
      {dagVisible ? (
        <>
          {/* Main content area - flex-1 fills remaining space */}
          <main
            className={cn(
              "relative min-w-0 flex-1",
              // Only style containment for ReactFlow compatibility
              "contain-style",
            )}
            role="main"
            aria-label={mainAriaLabel ?? "Workflow DAG view"}
          >
            {dagContent}
          </main>

          {/* Panel slot - DetailsPanel handles its own width/collapse */}
          {panel}
        </>
      ) : (
        // Panel-only mode - full width
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
