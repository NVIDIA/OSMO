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
 * FileBrowserControls — Version/member switcher for the dataset file browser.
 *
 * Rendered via usePage({ headerActions }) so it appears in the chrome header on
 * the right side of the breadcrumb nav, adjacent to the theme toggle and user menu.
 *
 * The Details toggle button has been removed — the right panel is always visible.
 */

"use client";

import { memo } from "react";
import { VersionSwitcher, type SwitcherItem } from "@/features/datasets/detail/components/version-switcher";

interface FileBrowserControlsProps {
  /** Switcher items (versions or collection members) */
  items: SwitcherItem[];
  /** Currently selected item ID (null = latest/last) */
  selectedId: string | null;
  /** Called when the selection changes */
  onSelectionChange: (id: string) => void;
}

export const FileBrowserControls = memo(function FileBrowserControls({
  items,
  selectedId,
  onSelectionChange,
}: FileBrowserControlsProps) {
  if (items.length === 0) return null;

  return (
    <VersionSwitcher
      items={items}
      selectedId={selectedId}
      onSelectionChange={onSelectionChange}
    />
  );
});
