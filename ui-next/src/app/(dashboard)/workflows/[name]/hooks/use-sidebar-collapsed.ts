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

import { useState, useMemo } from "react";
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

  // Track the selection key that the user has explicitly collapsed on
  // When selectionKey !== collapsedOnKey, the panel auto-expands (derived state)
  // This avoids setState in useEffect by deriving the expanded state from comparison
  const [collapsedOnKey, setCollapsedOnKey] = useState<string | null>(null);

  // Derive collapsed state without needing an effect:
  // - No selection: use user preference
  // - Has selection AND user explicitly collapsed on this exact key: collapsed
  // - Has selection but different key (navigation occurred): auto-expand
  const collapsed = useMemo(() => {
    if (!hasSelection) {
      return preferredCollapsed;
    }
    // Auto-expand if the selection changed (navigation to new node)
    // Only stay collapsed if user explicitly collapsed on this exact selection
    return selectionKey === collapsedOnKey;
  }, [hasSelection, preferredCollapsed, selectionKey, collapsedOnKey]);

  // Toggle collapsed state - stable callback for memoized children
  const toggle = useEventCallback(() => {
    if (hasSelection) {
      // Toggle: if currently collapsed, clear the key to expand
      // If currently expanded, set the key to collapse
      setCollapsedOnKey(collapsed ? null : selectionKey);
    } else {
      setPreferredCollapsed((prev) => !prev);
    }
  });

  // Expand panel - stable callback for memoized children
  const expand = useEventCallback(() => {
    if (hasSelection) {
      // Clear the collapsed key to trigger expand
      setCollapsedOnKey(null);
    } else {
      setPreferredCollapsed(false);
    }
  });

  // Collapse panel - stable callback for memoized children
  const collapse = useEventCallback(() => {
    if (hasSelection) {
      // Set the collapsed key to current selection to mark as collapsed
      setCollapsedOnKey(selectionKey);
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
