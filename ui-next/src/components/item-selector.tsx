/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Item Selector Component
 *
 * A smart selector that adapts based on item count:
 * - Single item: Static label (no dropdown)
 * - Multiple items: Dropdown with checkmark on selected
 *
 * Used for platform/pool selection in detail panels.
 */

"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

// =============================================================================
// Types
// =============================================================================

export interface ItemSelectorProps {
  /** Available items to select from */
  items: string[];
  /** Currently selected item */
  selectedItem: string | null;
  /** Callback when an item is selected */
  onSelect: (item: string) => void;
  /** Optional label prefix (e.g., "Platform:", "Pool:") */
  label?: string;
  /** Optional default item to highlight differently */
  defaultItem?: string | null;
  /** Additional CSS classes for the trigger button */
  className?: string;
  /** Aria label for accessibility */
  "aria-label"?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ItemSelector - Adaptive single/multi item selector.
 *
 * @example
 * ```tsx
 * // Single item - renders as static text
 * <ItemSelector
 *   items={["dgx-h100"]}
 *   selectedItem="dgx-h100"
 *   onSelect={handleSelect}
 * />
 *
 * // Multiple items - renders as dropdown
 * <ItemSelector
 *   items={["dgx-h100", "dgx-a100", "hgx-h100"]}
 *   selectedItem="dgx-h100"
 *   defaultItem="dgx-h100"
 *   onSelect={handleSelect}
 *   aria-label="Select platform"
 * />
 * ```
 */
export function ItemSelector({
  items,
  selectedItem,
  onSelect,
  label,
  defaultItem,
  className,
  "aria-label": ariaLabel,
}: ItemSelectorProps) {
  // Single item: Static label (no interaction needed)
  if (items.length === 1) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {label && <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>}
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{items[0]}</span>
      </div>
    );
  }

  // Multiple items: Dropdown selector
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-1.5 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
            aria-label={ariaLabel ?? "Select item"}
          >
            <span className="text-sm font-medium">{selectedItem}</span>
            {selectedItem === defaultItem && (
              <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[0.625rem] font-medium text-zinc-500 uppercase dark:bg-zinc-700 dark:text-zinc-400">
                Default
              </span>
            )}
            <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
        >
          {items.map((item) => {
            const isCurrent = item === selectedItem;
            const isDefault = item === defaultItem;

            return (
              <DropdownMenuItem
                key={item}
                onSelect={() => onSelect(item)}
                className={cn("flex items-center gap-2", isCurrent && "bg-zinc-100 dark:bg-zinc-800")}
              >
                <span className={cn("flex-1 truncate", isCurrent && "font-medium")}>{item}</span>
                {isDefault && (
                  <span className="text-[0.625rem] text-zinc-400 uppercase dark:text-zinc-500">Default</span>
                )}
                {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
