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
 * useSpecViewState - URL-synced state for spec view toggle
 *
 * Manages the active spec view (yaml/template) via URL query parameter.
 * Uses `history: "replace"` so view changes don't pollute browser history.
 *
 * @example
 * ```tsx
 * const { activeView, setActiveView } = useSpecViewState();
 * // URL: /workflows/my-workflow?spec=jinja
 * ```
 */

"use client";

import { useCallback } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import type { SpecView } from "./useSpecData";

// =============================================================================
// Types
// =============================================================================

export interface UseSpecViewStateReturn {
  /** Current active view */
  activeView: SpecView;
  /** Set the active view */
  setActiveView: (view: SpecView) => void;
  /** Toggle between yaml and template */
  toggleView: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const SPEC_VIEWS = ["yaml", "jinja"] as const;
const DEFAULT_VIEW: SpecView = "yaml";

// =============================================================================
// Hook
// =============================================================================

/**
 * URL-synced state for the spec view toggle.
 *
 * - Default: 'yaml' (no URL param needed)
 * - Uses `history: "replace"` so view changes don't create browser history entries
 * - Clears param when set to default (yaml)
 */
export function useSpecViewState(): UseSpecViewStateReturn {
  const [view, setView] = useQueryState(
    "spec",
    parseAsStringLiteral(SPEC_VIEWS).withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Ensure we always have a valid view
  const activeView: SpecView = view ?? DEFAULT_VIEW;

  // Memoize setActiveView to prevent unnecessary re-renders
  const setActiveView = useCallback(
    (newView: SpecView) => {
      setView(newView === DEFAULT_VIEW ? null : newView);
    },
    [setView],
  );

  // Toggle between views
  const toggleView = useCallback(() => {
    setActiveView(activeView === "yaml" ? "jinja" : "yaml");
  }, [activeView, setActiveView]);

  return { activeView, setActiveView, toggleView };
}
