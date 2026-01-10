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
 * Most hooks are imported directly from @react-hookz/web.
 * Custom hooks are kept only when the library doesn't provide an equivalent.
 *
 * ## From @react-hookz/web (import directly)
 * - `useIsomorphicLayoutEffect` - SSR-safe useLayoutEffect
 * - `useSyncedRef` - Ref that always contains latest value
 * - `useMediaQuery` - CSS media query state tracking
 * - `useRafCallback` - RAF-throttled callback
 *
 * ## Custom Hooks
 * - `useStableCallback` - Returns stable function reference (library lacks typed overloads)
 * - `usePersistedBoolean` - localStorage-backed boolean with "osmo-" prefix
 * - `useCopyToClipboard` - Copy with "copied" feedback state
 * - `useVirtualizerCompat` - React Compiler compatible virtualizer
 */

// =============================================================================
// Custom Hooks
// =============================================================================

// Stability & Functional Correctness
export { useStableCallback } from "./use-stable-callback";

// Performance & Animation
export { useVirtualizerCompat } from "./use-virtualizer-compat";

// UI Components
export { usePersistedBoolean } from "./use-persisted-boolean";

// Accessibility
export {
  useAnnouncer,
  cleanupAnnouncer,
  type UseAnnouncerOptions,
  type AnnouncerPoliteness,
  type AnnounceFunction,
} from "./use-announcer";
export {
  useCopyToClipboard,
  type UseCopyToClipboardOptions,
  type UseCopyToClipboardReturn,
} from "./use-copy-to-clipboard";
export {
  useExpandableChips,
  type UseExpandableChipsOptions,
  type UseExpandableChipsResult,
} from "./use-expandable-chips";
export { useUrlChips, type UseUrlChipsOptions, type UseUrlChipsResult } from "./use-url-chips";

// Platform Detection
export { useIsMac } from "./use-mac";
