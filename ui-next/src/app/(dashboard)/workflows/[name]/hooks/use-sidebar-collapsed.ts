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

import { useState, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useStableCallback } from "@/hooks";

export interface UseSidebarCollapsedOptions {
  /** Whether there's an active group/task selection from URL */
  hasSelection: boolean;
  /** Unique key identifying the current selection (changes trigger auto-expand) */
  selectionKey: string | null;
}

/**
 * Internal state shape that tracks both session collapsed state and the selection key
 * that was active when the user last manually changed the collapsed state.
 */
interface SessionState {
  /** Whether the user has manually collapsed/expanded during this selection */
  collapsed: boolean | null;
  /** The selection key when the user last manually toggled */
  forSelectionKey: string | null;
}

const INITIAL_SESSION_STATE: SessionState = {
  collapsed: null,
  forSelectionKey: null,
};

export function useSidebarCollapsed({ hasSelection, selectionKey }: UseSidebarCollapsedOptions) {
  // User preference for default state (used when no selection)
  const [preferredCollapsed, setPreferredCollapsed] = useLocalStorage("osmo-workflow-details-sidebar-collapsed", false);

  // Session state tracks manual collapse/expand AND the selection it applies to
  const [sessionState, setSessionState] = useState<SessionState>(INITIAL_SESSION_STATE);

  // Determine if the current session state applies to the current selection
  // If the selection has changed, the previous session state is stale
  const isSessionStateValid = sessionState.forSelectionKey === selectionKey;

  // Get effective session collapsed value (null if stale or not set)
  const effectiveSessionCollapsed = isSessionStateValid ? sessionState.collapsed : null;

  // Determine effective collapsed state using useMemo for stable reference
  const collapsed = useMemo(() => {
    if (!hasSelection) {
      // No selection: use user preference
      return preferredCollapsed;
    }
    // Has selection: use session state if valid, otherwise default to expanded
    return effectiveSessionCollapsed ?? false;
  }, [hasSelection, preferredCollapsed, effectiveSessionCollapsed]);

  // Toggle collapsed state - stable callback for memoized children
  const toggle = useStableCallback(() => {
    if (hasSelection) {
      // During selection: update session state with current selection key
      setSessionState((prev) => ({
        collapsed: !(prev.forSelectionKey === selectionKey ? (prev.collapsed ?? false) : false),
        forSelectionKey: selectionKey,
      }));
    } else {
      // Workflow view: update preference
      setPreferredCollapsed((prev) => !prev);
    }
  });

  // Expand panel - stable callback for memoized children
  const expand = useStableCallback(() => {
    if (hasSelection) {
      setSessionState({
        collapsed: false,
        forSelectionKey: selectionKey,
      });
    } else {
      setPreferredCollapsed(false);
    }
  });

  // Collapse panel - stable callback for memoized children
  const collapse = useStableCallback(() => {
    if (hasSelection) {
      setSessionState({
        collapsed: true,
        forSelectionKey: selectionKey,
      });
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
