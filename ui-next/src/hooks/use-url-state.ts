/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * URL State Hooks
 *
 * Pre-configured hooks for common URL state patterns using nuqs.
 * Consolidates repeated URL state configuration across page components.
 *
 * ## Patterns
 *
 * - `useSelectionState` - For "view" parameter (push to history for back button)
 * - `useConfigState` - For "config" parameter (replace history, no back button)
 * - `usePanelState` - Combined selection + config for master/detail layouts
 *
 * @example
 * ```tsx
 * // Before: 8+ lines of boilerplate per page
 * const [selection, setSelection] = useQueryState("view",
 *   parseAsString.withOptions({ shallow: true, history: "push", clearOnDefault: true })
 * );
 *
 * // After: 1 line
 * const [selection, setSelection] = useSelectionState();
 *
 * // Or for full panel state:
 * const { selection, setSelection, config, setConfig, clear } = usePanelState();
 * ```
 */

"use client";

import { useCallback } from "react";
import { useQueryState, parseAsString } from "nuqs";

// =============================================================================
// Types
// =============================================================================

export interface UsePanelStateReturn {
  /** Current selection value (e.g., selected item name) */
  selection: string | null;
  /** Set the selection value */
  setSelection: (value: string | null) => void;
  /** Current config value (e.g., selected sub-item or tab) */
  config: string | null;
  /** Set the config value */
  setConfig: (value: string | null) => void;
  /** Clear both selection and config */
  clear: () => void;
}

// =============================================================================
// Selection State Hook
// =============================================================================

/**
 * URL state for primary selection (e.g., selected item in a list).
 *
 * Uses `history: "push"` so users can navigate back to previous selections.
 *
 * @param key - URL parameter key (default: "view")
 * @returns Tuple of [value, setter] like useState
 *
 * @example
 * ```tsx
 * const [selectedPoolName, setSelectedPoolName] = useSelectionState();
 * // URL: /pools?view=my-pool
 * ```
 */
export function useSelectionState(key: string = "view") {
  return useQueryState(
    key,
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );
}

// =============================================================================
// Config State Hook
// =============================================================================

/**
 * URL state for secondary configuration (e.g., selected tab or sub-item).
 *
 * Uses `history: "replace"` so config changes don't pollute browser history.
 *
 * @param key - URL parameter key (default: "config")
 * @returns Tuple of [value, setter] like useState
 *
 * @example
 * ```tsx
 * const [selectedPlatform, setSelectedPlatform] = useConfigState();
 * // URL: /pools?view=my-pool&config=dgx
 * ```
 */
export function useConfigState(key: string = "config") {
  return useQueryState(
    key,
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );
}

// =============================================================================
// Combined Panel State Hook
// =============================================================================

/**
 * Combined URL state for master/detail panel layouts.
 *
 * Provides selection state (push history) and config state (replace history)
 * along with a clear function to reset both.
 *
 * @param selectionKey - URL parameter for selection (default: "view")
 * @param configKey - URL parameter for config (default: "config")
 * @returns Object with selection, config, setters, and clear function
 *
 * @example
 * ```tsx
 * const { selection, setSelection, config, setConfig, clear } = usePanelState();
 *
 * // Select an item
 * setSelection("my-pool");  // URL: /pools?view=my-pool
 *
 * // Select a sub-item
 * setConfig("dgx");  // URL: /pools?view=my-pool&config=dgx
 *
 * // Close panel (clear both)
 * clear();  // URL: /pools
 * ```
 */
export function usePanelState(selectionKey: string = "view", configKey: string = "config"): UsePanelStateReturn {
  const [selection, setSelection] = useSelectionState(selectionKey);
  const [config, setConfig] = useConfigState(configKey);

  const clear = useCallback(() => {
    setSelection(null);
    setConfig(null);
  }, [setSelection, setConfig]);

  return {
    selection,
    setSelection,
    config,
    setConfig,
    clear,
  };
}
