//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * usePanelFocus - Hook for focusing the containing panel after instant form actions.
 *
 * Use this for radio buttons, checkboxes, or other form elements where the action
 * is instant (not an ongoing edit). This ensures ESC works immediately after selection.
 *
 * @example
 * ```tsx
 * const focusPanel = usePanelFocus();
 *
 * const handleChange = (value: string) => {
 *   onChange(value);
 *   focusPanel(); // Focus panel so ESC works
 * };
 * ```
 */

import { useCallback } from "react";

/**
 * Hook that returns a function to focus the containing panel.
 *
 * Finds the closest panel container (role="complementary") and focuses it.
 * This ensures ESC key works after instant form actions (radio, checkbox, etc.)
 * where the form element gets focused but the action is complete.
 */
export function usePanelFocus(): () => void {
  return useCallback(() => {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;

      // Find the panel container from the current active element
      const panel =
        activeElement instanceof HTMLElement
          ? activeElement.closest('[role="complementary"]')
          : document.querySelector('[role="complementary"]');

      if (panel instanceof HTMLElement) {
        // Blur the current element if it's a form control
        if (activeElement instanceof HTMLElement && activeElement !== panel) {
          activeElement.blur();
        }

        // Focus the panel (it has tabindex="-1" from ResizablePanel)
        panel.focus();
      }
    });
  }, []);
}
