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
 * Reconciles user preference with navigation intent:
 * - User preference (localStorage): Default collapsed state for workflow overview
 * - Navigation intent: Clicking a node or URL navigation should show the content
 *
 * Behavior:
 * - Workflow view (no selection): Uses user preference
 * - Group/Task view: Auto-expands on navigation, user can manually collapse
 * - New navigation: Resets to expanded (shows the content user navigated to)
 * - Escape key: Collapses panel
 * - Enter key: Expands panel
 *
 * @param hasSelection - Whether there's an active group/task selection
 * @param selectionKey - Unique key for current selection (e.g., "group:step-1" or "task:step-1:my-task")
 *                       Changes to this key trigger auto-expand behavior
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";

export interface UseSidebarCollapsedOptions {
  /** Whether there's an active group/task selection from URL */
  hasSelection: boolean;
  /** Unique key identifying the current selection (changes trigger auto-expand) */
  selectionKey: string | null;
}

export function useSidebarCollapsed({ hasSelection, selectionKey }: UseSidebarCollapsedOptions) {
  // User preference for default state (used when no selection)
  const [preferredCollapsed, setPreferredCollapsed] = useLocalStorage(
    "osmo-workflow-details-sidebar-collapsed",
    false,
  );

  // Current collapsed state (may differ from preference during navigation)
  const [sessionCollapsed, setSessionCollapsed] = useState<boolean | null>(null);

  // Track the previous selection key to detect navigation changes
  const prevSelectionKeyRef = useRef<string | null>(null);

  // Determine effective collapsed state
  // - If no selection: use user preference
  // - If selection and session state set: use session state
  // - If selection but no session state yet: expanded (auto-expand on first navigation)
  const collapsed = hasSelection
    ? sessionCollapsed ?? false // Default to expanded when navigating to selection
    : preferredCollapsed;

  // Auto-expand when navigating to a NEW selection
  // This runs when selectionKey changes (user clicked different group/task or navigated via URL)
  useEffect(() => {
    if (selectionKey !== prevSelectionKeyRef.current) {
      if (selectionKey !== null) {
        // Navigating to a new selection: auto-expand
        setSessionCollapsed(false);
      } else {
        // Navigating away from selection (back to workflow): reset session state
        setSessionCollapsed(null);
      }
      prevSelectionKeyRef.current = selectionKey;
    }
  }, [selectionKey]);

  // Toggle collapsed state
  const toggle = useCallback(() => {
    if (hasSelection) {
      // During selection: update session state
      setSessionCollapsed((prev) => !(prev ?? false));
    } else {
      // Workflow view: update preference
      setPreferredCollapsed((prev) => !prev);
    }
  }, [hasSelection, setPreferredCollapsed]);

  // Expand panel
  const expand = useCallback(() => {
    if (hasSelection) {
      setSessionCollapsed(false);
    } else {
      setPreferredCollapsed(false);
    }
  }, [hasSelection, setPreferredCollapsed]);

  // Collapse panel
  const collapse = useCallback(() => {
    if (hasSelection) {
      setSessionCollapsed(true);
    } else {
      setPreferredCollapsed(true);
    }
  }, [hasSelection, setPreferredCollapsed]);

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
