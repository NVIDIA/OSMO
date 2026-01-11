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
 * Most hooks are imported directly from libraries:
 * - `@react-hookz/web` - useIsomorphicLayoutEffect, useSyncedRef, useMediaQuery, useRafCallback
 * - `usehooks-ts` - useLocalStorage, useCopyToClipboard (base)
 *
 * ## Custom Hooks (kept for specific reasons)
 * - `useStableCallback` - TypeScript overloads preserve arg/return types (library versions use `any`)
 * - `useVirtualizerCompat` - React Compiler workaround for @tanstack/react-virtual
 * - `useAnnouncer` - Avoids adding React Aria parallel to Radix ecosystem
 * - `useCopy` - Thin wrapper on usehooks-ts with auto-reset for UI feedback
 * - `useExpandableChips` - Unique measurement logic for chip overflow
 * - `useUrlChips` - URL state management for SmartSearch chips
 */

// =============================================================================
// Custom Hooks
// =============================================================================

// Stability & Functional Correctness
export { useStableCallback } from "./use-stable-callback";

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
export {
  useExpandableChips,
  type UseExpandableChipsOptions,
  type UseExpandableChipsResult,
} from "./use-expandable-chips";
export { useUrlChips, type UseUrlChipsOptions, type UseUrlChipsResult } from "./use-url-chips";
