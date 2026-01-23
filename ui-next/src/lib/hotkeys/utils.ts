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

import type { HotkeyRegistry } from "./types";
import { GLOBAL_HOTKEYS } from "./global";
import { TERMINAL_HOTKEYS, SHELL_SEARCH_HOTKEYS } from "@/components/shell/hotkeys";
import { DATA_TABLE_HOTKEYS } from "@/components/data-table/hotkeys";
import { FILTER_BAR_HOTKEYS } from "@/components/filter-bar/hotkeys";
import { PANEL_HOTKEYS } from "@/components/panel/hotkeys";

/**
 * Get all registered hotkey registries.
 * Useful for generating help dialog or debugging conflicts.
 */
export function getAllHotkeyRegistries(): HotkeyRegistry[] {
  return [
    GLOBAL_HOTKEYS,
    TERMINAL_HOTKEYS,
    SHELL_SEARCH_HOTKEYS,
    DATA_TABLE_HOTKEYS,
    FILTER_BAR_HOTKEYS,
    PANEL_HOTKEYS,
  ];
}

/**
 * Check if a keyboard combination conflicts with known browser shortcuts.
 * Returns the browser action if conflict found, null otherwise.
 */
export function checkBrowserConflict(key: string): string | null {
  const registries = getAllHotkeyRegistries();
  for (const registry of registries) {
    if (registry.browserConflicts?.[key]) {
      return registry.browserConflicts[key];
    }
  }
  return null;
}

/**
 * Get all shortcuts grouped by category.
 * Useful for displaying in a help dialog.
 */
export function getShortcutsByCategory(): Record<
  string,
  Array<{
    key: string;
    description: string;
    registry: string;
    scoped: boolean;
  }>
> {
  const registries = getAllHotkeyRegistries();
  const byCategory: Record<string, any[]> = {};

  for (const registry of registries) {
    for (const def of Object.values(registry.shortcuts)) {
      const category = def.category || "Other";
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push({
        key: def.key,
        description: def.description,
        registry: registry.label,
        scoped: def.scoped || false,
      });
    }
  }

  return byCategory;
}

/**
 * Get all browser conflicts across all registries.
 * Returns a map of keyboard combinations to browser actions.
 */
export function getAllBrowserConflicts(): Record<string, string> {
  const registries = getAllHotkeyRegistries();
  const conflicts: Record<string, string> = {};

  for (const registry of registries) {
    if (registry.browserConflicts) {
      Object.assign(conflicts, registry.browserConflicts);
    }
  }

  return conflicts;
}
