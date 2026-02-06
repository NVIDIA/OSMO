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
 * usePanelEscape - Shared ESC key handling for panel components.
 *
 * Handles ESC key with proper scoping:
 * - Only triggers when focus is within the panel
 * - Skips when focus is on interactive elements (dropdowns, etc.)
 * - Allows multiple panels to coexist without interference
 */

import { type RefObject } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useEventCallback } from "usehooks-ts";
import { isInteractiveTarget } from "@/lib/utils";

export interface UsePanelEscapeOptions {
  /** Ref to the panel element */
  panelRef: RefObject<HTMLElement | null>;
  /** Callback when ESC is pressed within the panel (or globally if global=true) */
  onEscape: () => void;
  /** Whether the ESC handler is enabled */
  enabled?: boolean;
  /** If true, fire ESC handler regardless of focus location (useful for side panels) */
  global?: boolean;
}

/**
 * Hook that handles ESC key for panels with proper focus scoping.
 *
 * Only fires the onEscape callback when:
 * 1. ESC is pressed
 * 2. Focus is within the panel (or anywhere if global=true)
 * 3. Not in dropdowns or other interactive elements
 * 4. The handler is enabled
 *
 * @example
 * ```tsx
 * // Focus-scoped (default) - for overlay panels
 * const panelRef = useRef<HTMLElement>(null);
 * usePanelEscape({
 *   panelRef,
 *   onEscape: () => console.log('Panel should close'),
 *   enabled: isOpen,
 * });
 *
 * // Global - for side panels that should collapse regardless of focus
 * usePanelEscape({
 *   panelRef,
 *   onEscape: () => console.log('Panel should collapse'),
 *   enabled: true,
 *   global: true,
 * });
 * ```
 */
export function usePanelEscape({ panelRef, onEscape, enabled = true, global = false }: UsePanelEscapeOptions) {
  const stableOnEscape = useEventCallback(onEscape);

  useHotkeys(
    "escape",
    (e) => {
      // Skip if target is in a dropdown or interactive element
      if (isInteractiveTarget(e.target)) return;

      if (global) {
        // Global mode: fire handler regardless of focus location
        stableOnEscape();
      } else {
        // Focus-scoped mode: only handle ESC if focus is within THIS panel
        // This allows multiple panels to coexist - only the one with focus handles ESC
        if (panelRef.current?.contains(document.activeElement)) {
          stableOnEscape();
        }
      }
    },
    {
      enabled,
      enableOnFormTags: false, // Don't trigger when focused on input/textarea/select
    },
    [stableOnEscape, global],
  );
}
