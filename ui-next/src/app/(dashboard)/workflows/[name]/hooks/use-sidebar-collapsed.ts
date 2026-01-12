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
 * Single collapse/expand state (NOT per-node):
 * - User preference (localStorage): Default collapsed state for workflow overview
 * - Session state: Single collapsed state that persists across node selections
 *
 * Behavior:
 * - Workflow view (no selection): Uses user preference
 * - Any navigation to a selection: Auto-expands panel (new node = show details)
 * - User can manually collapse: State persists until next navigation
 * - Navigating to different nodes: Always expands (user clicked to see details)
 * - Escape key: Collapses panel
 * - Enter key: Expands panel
 *
 * @param hasSelection - Whether there's an active group/task selection
 * @param selectionKey - Unique key for current selection (changes trigger auto-expand)
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useEventCallback } from "usehooks-ts";

export interface UseSidebarCollapsedOptions {
  /** Whether there's an active group/task selection from URL */
  hasSelection: boolean;
  /** Unique key identifying the current selection (changes trigger auto-expand) */
  selectionKey: string | null;
}

export function useSidebarCollapsed({ hasSelection, selectionKey }: UseSidebarCollapsedOptions) {
  // User preference for default state (used when no selection)
  const [preferredCollapsed, setPreferredCollapsed] = useLocalStorage("osmo-workflow-details-sidebar-collapsed", false);

  // Single session collapsed state (NOT per-node)
  const [sessionCollapsed, setSessionCollapsed] = useState(false);

  // Track the previous selection key to detect navigation changes
  const prevSelectionKeyRef = useRef<string | null>(null);

  // Auto-expand on navigation to a new selection
  // This runs AFTER render, so we set the state for next render
  useEffect(() => {
    const prevKey = prevSelectionKeyRef.current;
    prevSelectionKeyRef.current = selectionKey;

    // If we now have a selection (or selection changed), auto-expand
    // This covers:
    // - Clicking a node when panel is collapsed → expand
    // - Navigating via URL to a node → expand
    // - Clicking a different node → expand
    if (selectionKey !== null && selectionKey !== prevKey) {
      setSessionCollapsed(false);
    }
  }, [selectionKey]);

  // Determine effective collapsed state
  // - No selection: use user preference
  // - Has selection: use session state
  const collapsed = hasSelection ? sessionCollapsed : preferredCollapsed;

  // Toggle collapsed state - stable callback for memoized children
  const toggle = useEventCallback(() => {
    if (hasSelection) {
      setSessionCollapsed((prev) => !prev);
    } else {
      setPreferredCollapsed((prev) => !prev);
    }
  });

  // Expand panel - stable callback for memoized children
  const expand = useEventCallback(() => {
    if (hasSelection) {
      setSessionCollapsed(false);
    } else {
      setPreferredCollapsed(false);
    }
  });

  // Collapse panel - stable callback for memoized children
  const collapse = useEventCallback(() => {
    if (hasSelection) {
      setSessionCollapsed(true);
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
