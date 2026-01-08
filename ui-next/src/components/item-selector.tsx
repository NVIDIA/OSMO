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
 * - Multiple items: Select dropdown with checkmark on selected
 *
 * Uses shadcn/ui Select primitive.
 */

"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/shadcn/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select";

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
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
        <span className="text-sm font-medium">{items[0]}</span>
      </div>
    );
  }

  // Multiple items: Select dropdown
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
      <Select value={selectedItem ?? undefined} onValueChange={onSelect}>
        <SelectTrigger
          size="sm"
          className="h-auto gap-1.5 border-0 bg-transparent px-0 py-0.5 shadow-none hover:bg-accent/50"
          aria-label={ariaLabel ?? "Select item"}
        >
          <SelectValue />
          {selectedItem === defaultItem && (
            <Badge variant="secondary" className="ml-1 text-[0.625rem] uppercase">
              Default
            </Badge>
          )}
        </SelectTrigger>
        <SelectContent align="start" className="min-w-56">
          {items.map((item) => {
            const isDefault = item === defaultItem;

            return (
              <SelectItem key={item} value={item}>
                <span className="flex-1 truncate">{item}</span>
                {isDefault && (
                  <span className="ml-2 text-[0.625rem] text-muted-foreground uppercase">
                    Default
                  </span>
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
