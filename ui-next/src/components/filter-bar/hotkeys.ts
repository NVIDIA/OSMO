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

import type { HotkeyRegistry } from "@/lib/hotkeys/types";

/**
 * Filter bar keyboard shortcuts (scoped to filter input and chips).
 * Active when filter bar has focus.
 *
 * Implementation: filter-bar.tsx component
 */
export const FILTER_BAR_HOTKEYS: HotkeyRegistry = {
  id: "filter-bar",
  label: "Filter Bar",
  shortcuts: {
    NAVIGATE_CHIPS_LEFT: {
      key: "ArrowLeft",
      description: "Navigate to previous filter chip",
      category: "Filtering",
      scoped: true,
    },
    NAVIGATE_CHIPS_RIGHT: {
      key: "ArrowRight",
      description: "Navigate to next filter chip",
      category: "Filtering",
      scoped: true,
    },
    REMOVE_CHIP_BACKSPACE: {
      key: "Backspace",
      description: "Remove focused filter chip",
      category: "Filtering",
      scoped: true,
    },
    REMOVE_CHIP_DELETE: {
      key: "Delete",
      description: "Remove focused filter chip",
      category: "Filtering",
      scoped: true,
    },
    CLOSE_DROPDOWN: {
      key: "Escape",
      description: "Close filter dropdown",
      category: "Filtering",
      scoped: true,
    },
    APPLY_FILTER: {
      key: "Enter",
      description: "Apply filter and close dropdown",
      category: "Filtering",
      scoped: true,
    },
  },
};
