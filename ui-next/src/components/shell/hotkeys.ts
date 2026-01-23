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
 * Terminal keyboard shortcuts (scoped to terminal container).
 * Active only when terminal is focused.
 *
 * Implementation: ShellTerminalImpl.tsx uses manual addEventListener
 * because these shortcuts require custom logic (e.g., Cmd+C only copies
 * if text is selected, otherwise sends SIGINT).
 */
export const TERMINAL_HOTKEYS: HotkeyRegistry = {
  id: "terminal",
  label: "Terminal",
  shortcuts: {
    TOGGLE_SEARCH: {
      key: "mod+f",
      description: "Toggle search in terminal",
      category: "Terminal",
      scoped: true,
    },
    COPY_SELECTION: {
      key: "mod+c",
      description: "Copy selected text (when text is selected)",
      category: "Terminal",
      scoped: true,
    },
    PASTE: {
      key: "mod+v",
      description: "Paste from clipboard",
      category: "Terminal",
      scoped: true,
    },
  },
  browserConflicts: {
    "mod+f": "Browser find - overridden in terminal when focused",
  },
};

/**
 * Shell search keyboard shortcuts (scoped to search input).
 * Active only when shell search is open.
 */
export const SHELL_SEARCH_HOTKEYS: HotkeyRegistry = {
  id: "shell-search",
  label: "Shell Search",
  shortcuts: {
    FOCUS_SEARCH: {
      key: "mod+f",
      description: "Focus search input",
      category: "Terminal",
      scoped: true,
    },
    FIND_NEXT: {
      key: "Enter",
      description: "Find next match",
      category: "Terminal",
      scoped: true,
    },
    FIND_PREVIOUS: {
      key: "Shift+Enter",
      description: "Find previous match",
      category: "Terminal",
      scoped: true,
    },
    CLOSE_SEARCH: {
      key: "Escape",
      description: "Close search",
      category: "Terminal",
      scoped: true,
    },
  },
};
