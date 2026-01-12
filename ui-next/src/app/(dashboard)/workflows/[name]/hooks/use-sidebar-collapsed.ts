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

/**
 * Hook for managing workflow details sidebar collapsed state.
 *
 * GLOBAL collapse/expand state (NOT per-node):
 * - User preference (localStorage): Default collapsed state for workflow overview
 * - Session state: Single global collapsed state, NOT tied to specific nodes
 *
 * Behavior:
 * - Workflow view (no selection): Uses user preference
 * - Any navigation (node click OR URL change): Auto-expands panel
 * - User can manually collapse: Stays collapsed until next navigation
 * - Panel state is GLOBAL - no per-node memory
 * - Escape key: Collapses panel
 * - Enter key: Expands panel
 *
 * @param hasSelection - Whether there's an active group/task selection
 * @param selectionKey - Unique key for current selection (changes trigger auto-expand)
 */

"use client";

import { useState, useRef } from "react";
import { useLocalStorage, useEventCallback, useIsomorphicLayoutEffect } from "usehooks-ts";

export interface UseSidebarCollapsedOptions {
  /** Whether there's an active group/task selection from URL */
  hasSelection: boolean;
  /** Unique key identifying the current selection (changes trigger auto-expand) */
  selectionKey: string | null;
}

export function useSidebarCollapsed({ hasSelection, selectionKey }: UseSidebarCollapsedOptions) {
  // User preference for default state (used when no selection)
  const [preferredCollapsed, setPreferredCollapsed] = useLocalStorage("osmo-workflow-details-sidebar-collapsed", false);

  // Global collapsed state - NOT tied to any specific node
  // This is the user's manual collapse action that persists until next navigation
  const [userCollapsed, setUserCollapsed] = useState(false);

  // Track previous selection key to detect navigation
  const prevSelectionKeyRef = useRef<string | null>(null);

  // Auto-expand on ANY navigation (click or URL change)
  // Using layout effect to update state before render to avoid flicker
  useIsomorphicLayoutEffect(() => {
    // Detect if selection changed (navigation occurred)
    const prevKey = prevSelectionKeyRef.current;
    const navigationOccurred = selectionKey !== prevKey && selectionKey !== null;

    if (navigationOccurred) {
      // Any navigation auto-expands the panel
      setUserCollapsed(false);
    }

    // Update ref for next comparison
    prevSelectionKeyRef.current = selectionKey;
  }, [selectionKey]);

  // Derive collapsed state:
  // - No selection: use user preference
  // - Has selection: use global userCollapsed state
  const collapsed = hasSelection ? userCollapsed : preferredCollapsed;

  // Toggle collapsed state - stable callback for memoized children
  const toggle = useEventCallback(() => {
    if (hasSelection) {
      setUserCollapsed((prev) => !prev);
    } else {
      setPreferredCollapsed((prev) => !prev);
    }
  });

  // Expand panel - stable callback for memoized children
  const expand = useEventCallback(() => {
    if (hasSelection) {
      setUserCollapsed(false);
    } else {
      setPreferredCollapsed(false);
    }
  });

  // Collapse panel - stable callback for memoized children
  const collapse = useEventCallback(() => {
    if (hasSelection) {
      setUserCollapsed(true);
    } else {
      setPreferredCollapsed(true);
    }
  });

  return {
    /** Current collapsed state (considering preference and navigation) */
    collapsed,
    /** Toggle collapsed state */
    toggle,
    /** Expand panel */
    expand,
    /** Collapse panel */
    collapse,
    /** User's preferred default state (for workflow overview) */
    preferredCollapsed,
    /** Update user preference directly */
    setPreferredCollapsed,
  };
}
