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
 * Panel tabs keyboard shortcuts (scoped to panel tab list).
 * Active when panel tabs have focus.
 *
 * Implementation: panel-tabs.tsx component
 */
export const PANEL_HOTKEYS: HotkeyRegistry = {
  id: "panel-tabs",
  label: "Panel Tabs",
  shortcuts: {
    PREVIOUS_TAB: {
      key: "ArrowLeft",
      description: "Switch to previous tab",
      category: "Panel Navigation",
      scoped: true,
    },
    NEXT_TAB: {
      key: "ArrowRight",
      description: "Switch to next tab",
      category: "Panel Navigation",
      scoped: true,
    },
    FIRST_TAB: {
      key: "Home",
      description: "Jump to first tab",
      category: "Panel Navigation",
      scoped: true,
    },
    LAST_TAB: {
      key: "End",
      description: "Jump to last tab",
      category: "Panel Navigation",
      scoped: true,
    },
  },
};
