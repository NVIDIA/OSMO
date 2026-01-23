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
 * Data table keyboard navigation (scoped to table rows).
 * Active when a table row has focus.
 *
 * Implementation: use-row-navigation.ts hook
 */
export const DATA_TABLE_HOTKEYS: HotkeyRegistry = {
  id: "data-table",
  label: "Data Table",
  shortcuts: {
    NAVIGATE_UP: {
      key: "ArrowUp",
      description: "Move to previous row",
      category: "Table Navigation",
      scoped: true,
    },
    NAVIGATE_DOWN: {
      key: "ArrowDown",
      description: "Move to next row",
      category: "Table Navigation",
      scoped: true,
    },
    JUMP_TO_TOP: {
      key: "Home",
      description: "Jump to first row",
      category: "Table Navigation",
      scoped: true,
    },
    JUMP_TO_BOTTOM: {
      key: "End",
      description: "Jump to last row",
      category: "Table Navigation",
      scoped: true,
    },
    PAGE_UP: {
      key: "PageUp",
      description: "Move up one page",
      category: "Table Navigation",
      scoped: true,
    },
    PAGE_DOWN: {
      key: "PageDown",
      description: "Move down one page",
      category: "Table Navigation",
      scoped: true,
    },
    ACTIVATE_ROW: {
      key: "Enter",
      description: "Open/activate selected row",
      category: "Table Navigation",
      scoped: true,
    },
    ACTIVATE_ROW_SPACE: {
      key: "Space",
      description: "Open/activate selected row",
      category: "Table Navigation",
      scoped: true,
    },
  },
};
