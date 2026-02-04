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
 * SelectableList Component
 *
 * A reusable searchable list with radio indicators for selecting a single item.
 * Used by both Pools and Buckets cards in the profile page.
 */

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/shadcn/input";

export interface SelectableListItem {
  value: string;
  label: string;
  subtitle?: string;
}

interface SelectableListProps {
  items: SelectableListItem[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}

export function SelectableList({
  items,
  selectedValue,
  onSelect,
  searchPlaceholder = "Search...",
  emptyMessage = "No items found",
  className = "",
}: SelectableListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(query));
  }, [items, searchQuery]);

  return (
    <div className="flex h-full flex-col">
      {/* Search input */}
      <div className="relative mb-4 shrink-0">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-muted pl-9"
        />
      </div>

      {/* List container with scrollable area */}
      <div className={`border-border bg-muted relative flex-1 overflow-y-auto rounded-md border ${className}`}>
        {filteredItems.length > 0 ? (
          <div className="flex flex-col">
            {filteredItems.map((item) => {
              const isSelected = item.value === selectedValue;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onSelect(item.value)}
                  className={`bg-background border-border flex cursor-pointer items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-b-0 ${
                    isSelected ? "bg-nvidia-bg border-l-nvidia border-l-[3px] pl-[calc(1rem-3px)]" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Radio indicator */}
                    <div
                      className={`size-4 shrink-0 rounded-full border-2 ${
                        isSelected ? "border-nvidia" : "border-border"
                      } relative transition-colors`}
                    >
                      {isSelected && (
                        <div className="bg-nvidia absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{item.label}</span>
                      {item.subtitle && <span className="text-muted-foreground text-xs">{item.subtitle}</span>}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="bg-nvidia rounded px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-white uppercase">
                      Default
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-8 text-sm">
            {searchQuery ? `No items match "${searchQuery}"` : emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
