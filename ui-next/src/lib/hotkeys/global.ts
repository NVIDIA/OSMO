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
 * Global keyboard shortcuts that work across the entire application.
 * These shortcuts are always active regardless of focus.
 *
 * Usage:
 * ```typescript
 * import { GLOBAL_HOTKEYS } from '@/lib/hotkeys/global';
 * useHotkeys(GLOBAL_HOTKEYS.shortcuts.TOGGLE_SIDEBAR.key, handler);
 * ```
 */
export const GLOBAL_HOTKEYS: HotkeyRegistry = {
  id: "global",
  label: "Global",
  shortcuts: {
    TOGGLE_SIDEBAR: {
      key: "mod+b",
      description: "Toggle left sidebar",
      category: "Navigation",
    },
    TOGGLE_DETAILS_PANEL: {
      key: "mod+i",
      description: "Toggle workflow details panel",
      category: "Navigation",
    },
    CLOSE_PANEL: {
      key: "escape",
      description: "Close expanded panel",
      category: "Navigation",
    },
  },
  browserConflicts: {
    "mod+shift+b": "Chrome: Toggle bookmarks bar",
    "mod+t": "All browsers: New tab",
    "mod+w": "All browsers: Close tab",
    "mod+r": "All browsers: Reload page",
    "mod+f": "All browsers: Find in page",
    "mod+shift+f": "Chrome: Find in files",
    "mod+k": "Chrome: Focus address bar",
    "mod+l": "All browsers: Focus address bar",
    "mod+n": "All browsers: New window",
    "mod+shift+n": "Chrome/Edge: New incognito window",
    "mod+shift+t": "All browsers: Reopen closed tab",
  },
};
