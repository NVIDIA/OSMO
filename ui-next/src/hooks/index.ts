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
 * Shared React Hooks
 *
 * ## Library Hooks (import directly where needed)
 *
 * ### @react-hookz/web
 * - `useIsomorphicLayoutEffect` - SSR-safe useLayoutEffect
 * - `useSyncedRef` - Ref synced to value
 * - `useMediaQuery` - CSS media query state
 * - `useRafCallback` - RAF-throttled callback
 * - `usePrevious` - Previous value tracking
 * - `useDocumentVisibility` - Tab visibility detection
 *
 * ### usehooks-ts
 * - `useLocalStorage` - localStorage sync
 * - `useCopyToClipboard` - Clipboard API
 * - `useEventListener` - DOM event listener
 * - `useEventCallback` - Stable callback reference (replaces custom useStableCallback)
 * - `useResizeObserver` - Element resize observer
 * - `useInterval` - setInterval wrapper
 * - `useUnmount` - Unmount callback
 * - `useBoolean` - Boolean state with toggle/on/off
 *
 * ## Custom Hooks (kept for specific reasons)
 * - `useVirtualizerCompat` - React Compiler workaround for @tanstack/react-virtual
 * - `useAnnouncer` - Avoids adding React Aria parallel to Radix ecosystem
 * - `useCopy` - Thin wrapper on usehooks-ts with auto-reset for UI feedback
 * - `useExpandableChips` - Unique measurement logic for chip overflow
 * - `useUrlChips` - URL state management for SmartSearch chips
 * - `useTick` / `useTickController` - Synchronized timestamp for aligned live durations
 */

// =============================================================================
// Custom Hooks
// =============================================================================

// Performance & Animation
export { useVirtualizerCompat } from "./use-virtualizer-compat";

// Clipboard
export { useCopy, type UseCopyOptions, type UseCopyReturn } from "./use-copy";

// Accessibility
export {
  useAnnouncer,
  cleanupAnnouncer,
  type UseAnnouncerOptions,
  type AnnouncerPoliteness,
  type AnnounceFunction,
} from "./use-announcer";

// Expandable Chips
export {
  useExpandableChips,
  type UseExpandableChipsOptions,
  type UseExpandableChipsResult,
} from "./use-expandable-chips";

// URL Chips
export { useUrlChips, type UseUrlChipsOptions, type UseUrlChipsResult } from "./use-url-chips";

// URL State (consolidated patterns for nuqs)
export { useSelectionState, useConfigState, usePanelState, type UsePanelStateReturn } from "./use-url-state";

// Results Count (for SmartSearch display)
export { useResultsCount, type UseResultsCountOptions } from "./use-results-count";

// Synchronized Tick (for aligned live durations)
export { useTick, useTickController, useLiveDuration, calculateLiveDuration } from "./use-tick";

// Server Actions (optimistic UI)
export { useOptimisticAction, useServerAction } from "./use-optimistic-action";
