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
 * General-purpose hooks used across the application.
 * Domain-specific hooks live in their respective modules
 * (e.g., headless/ for data fetching, auth/ for authentication).
 *
 * ## Stability Hooks
 * For preventing stale closures and ensuring callback stability:
 * - `useStableCallback` - Returns stable function reference that always calls latest version
 * - `useStableValue` - Returns ref that always contains latest value
 * - `useIsomorphicLayoutEffect` - SSR-safe useLayoutEffect
 * - `useEventListener` - Type-safe event listeners with automatic cleanup
 *
 * ## Performance Hooks
 * For 60fps interactions and RAF-throttled updates:
 * - `useRafState` - RAF-throttled state for smooth drag/resize interactions
 * - `useRafCssVar` - RAF-throttled CSS variable updates
 * - `useVirtualizerCompat` - React Compiler compatible virtualizer
 *
 * ## UI Hooks
 * - `useExpandableChips` - Responsive overflow for chip/pill lists
 * - `useUrlChips` - URL-synced search chips
 * - `usePersistedBoolean` - localStorage-backed boolean state
 */

// Stability & Functional Correctness
export { useStableCallback, useStableValue } from "./use-stable-callback";
export { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";
export { useEventListener } from "./use-event-listener";

// Performance & Animation
export {
  useRafState,
  type UseRafStateOptions,
  type UseRafStateResult,
} from "./use-raf-state";
export {
  useRafCssVar,
  type UseRafCssVarOptions,
  type UseRafCssVarResult,
} from "./use-raf-css-var";
export { useVirtualizerCompat } from "./use-virtualizer-compat";

// UI Components
export { usePersistedBoolean } from "./use-persisted-boolean";
export {
  useExpandableChips,
  type ChipLayoutDimensions,
  type MeasuredModeOptions,
  type UseExpandableChipsOptions,
  type UseExpandableChipsResult,
} from "./use-expandable-chips";
export { useUrlChips, type UseUrlChipsOptions, type UseUrlChipsResult } from "./use-url-chips";
