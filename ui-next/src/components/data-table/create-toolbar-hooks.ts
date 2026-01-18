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
 * Toolbar Hooks Factory
 *
 * Creates reusable hooks for toolbar components that access table store state.
 * Reduces boilerplate in feature-specific toolbar implementations.
 *
 * @example
 * ```ts
 * // In pools feature store
 * export const usePoolsTableStore = create<PoolsTableState>(...)
 *
 * // Create toolbar hooks
 * export const { useColumnVisibility, useDisplayMode } = createToolbarHooks(usePoolsTableStore);
 *
 * // In toolbar component
 * function PoolsToolbar() {
 *   const { visibleColumnIds, toggleColumn } = useColumnVisibility();
 *   // ...
 * }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal store interface required for toolbar hooks.
 * Table stores should implement at least these fields.
 */
export interface TableStoreState {
  visibleColumnIds: string[];
  toggleColumn: (columnId: string) => void;
  displayMode?: "normal" | "compact";
  setDisplayMode?: (mode: "normal" | "compact") => void;
}

/**
 * Column visibility state and actions.
 */
export interface ColumnVisibilityHookResult {
  visibleColumnIds: string[];
  toggleColumn: (columnId: string) => void;
}

/**
 * Display mode state and actions.
 */
export interface DisplayModeHookResult {
  displayMode: "normal" | "compact";
  setDisplayMode: (mode: "normal" | "compact") => void;
}

/**
 * Combined toolbar state.
 */
export interface ToolbarHooksResult {
  useColumnVisibility: () => ColumnVisibilityHookResult;
  useDisplayMode: () => DisplayModeHookResult;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create toolbar hooks from a table store.
 *
 * @param useStore - The Zustand store hook (e.g., usePoolsTableStore)
 * @returns Object with useColumnVisibility and useDisplayMode hooks
 *
 * @example
 * ```ts
 * const { useColumnVisibility, useDisplayMode } = createToolbarHooks(usePoolsTableStore);
 * ```
 */
export function createToolbarHooks<TState extends TableStoreState>(useStore: {
  <U>(selector: (state: TState) => U): U;
}): ToolbarHooksResult {
  /**
   * Hook to access column visibility state.
   */
  const useColumnVisibility = (): ColumnVisibilityHookResult => {
    const visibleColumnIds = useStore((state) => state.visibleColumnIds);
    const toggleColumn = useStore((state) => state.toggleColumn);
    return { visibleColumnIds, toggleColumn };
  };

  /**
   * Hook to access display mode state.
   */
  const useDisplayMode = (): DisplayModeHookResult => {
    const displayMode = useStore((state) => state.displayMode ?? "normal");
    const setDisplayMode = useStore((state) => state.setDisplayMode ?? (() => {}));
    return { displayMode, setDisplayMode };
  };

  return {
    useColumnVisibility,
    useDisplayMode,
  };
}
