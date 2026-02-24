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
 * useFocusReturn - Captures the trigger element on open, restores focus on close.
 *
 * Design Philosophy:
 * - Panels should restore focus to their trigger element when closed
 * - This creates a natural "stack" behavior for nested panels
 * - Each panel remembers what was focused when it opened
 * - No explicit stack data structure needed - the DOM focus chain is the stack
 *
 * Design Decisions:
 * - Captures document.activeElement when `open` transitions from false to true
 * - Restores focus when `open` transitions from true to false
 * - Uses refs (not state) to avoid re-renders
 * - Handles edge cases: trigger removed from DOM, trigger disabled, trigger inside
 *   another panel that is also closing
 * - Does NOT trap focus - this is purely capture/restore for non-modal panels
 *
 * Example Flow (Nested Panels):
 * 1. User on DAG, clicks node → focus is on DAG node
 * 2. Panel A opens → useFocusReturn captures DAG node, moves focus into panel
 * 3. User clicks button in Panel A → focus is on button
 * 4. Panel B opens → useFocusReturn captures button, moves focus into Panel B
 * 5. Panel B closes → useFocusReturn restores focus to button (in Panel A)
 * 6. Panel A closes → useFocusReturn restores focus to DAG node
 *
 * @example
 * ```tsx
 * function MyPanel({ open, onClose, children }) {
 *   useFocusReturn({ open });
 *   return open ? <aside>{children}</aside> : null;
 * }
 * ```
 */

import { useRef, useEffect } from "react";
import { usePrevious } from "@react-hookz/web";

export interface UseFocusReturnOptions {
  /** Whether the panel is currently open */
  open: boolean;
  /**
   * Delay in ms before restoring focus (default: 0).
   * Use a small delay (e.g., 16) if the closing panel has an exit animation
   * that could steal focus during the transition.
   */
  restoreDelay?: number;
  /**
   * Whether to restore focus at all (default: true).
   * Set to false if you want to capture the trigger but handle restoration
   * manually (e.g., for panels that transform into a different UI on close).
   */
  shouldRestore?: boolean;
}

/**
 * Hook that automatically captures and restores focus for panel components.
 *
 * Use this for overlay panels, sidebars, or any component that captures user
 * attention and should return focus to the trigger element when dismissed.
 *
 * Does NOT create a focus trap - users can still Tab out of the panel.
 * This is intentional for non-modal panels (role="complementary").
 *
 * @param options - Configuration options
 */
export function useFocusReturn({ open, restoreDelay = 0, shouldRestore = true }: UseFocusReturnOptions): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  const prevOpen = usePrevious(open);

  useEffect(() => {
    const justOpened = prevOpen === false && open === true;
    const justClosed = prevOpen === true && open === false;

    if (justOpened) {
      // Capture the element that had focus when the panel opened.
      // This is the "trigger" - typically the button the user clicked.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        triggerRef.current = active;
      }
    }

    if (justClosed && shouldRestore) {
      const trigger = triggerRef.current;
      triggerRef.current = null;

      if (!trigger) return;

      const restore = () => {
        // Guard: trigger must still be in the DOM and focusable
        // Check isConnected (in DOM), disabled attribute, and aria-disabled
        if (
          trigger.isConnected &&
          !trigger.hasAttribute("disabled") &&
          trigger.getAttribute("aria-disabled") !== "true"
        ) {
          trigger.focus();
        }
        // If trigger is gone or disabled, focus naturally falls to browser default (body)
        // This is acceptable - there's nowhere meaningful to return focus to
      };

      if (restoreDelay > 0) {
        const id = setTimeout(restore, restoreDelay);
        return () => clearTimeout(id);
      } else {
        // Use microtask to run after React has committed the close.
        // This ensures the closing panel's DOM has been removed/hidden
        // before we try to focus the trigger, preventing race conditions.
        // queueMicrotask runs after the current microtask queue (including
        // React's commit phase) but before the next paint.
        queueMicrotask(restore);
      }
    }
  }, [open, prevOpen, restoreDelay, shouldRestore]);
}
