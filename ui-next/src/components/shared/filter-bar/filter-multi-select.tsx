// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, type ElementType } from "react";
import { Search, ChevronDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface FilterMultiSelectProps<T extends string> {
  /** Icon to display in the trigger button */
  icon?: ElementType;
  /** Label for the dropdown trigger */
  label: string;
  /** Available options */
  options: T[];
  /** Currently selected options */
  selected: Set<T>;
  /** Callback when an option is toggled */
  onToggle: (option: T) => void;
  /** Callback to clear all selections (optional) */
  onClear?: () => void;
  /** Enable search within the dropdown (useful for long lists) */
  searchable?: boolean;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Render function for option labels (optional) */
  renderOption?: (option: T) => string;
  /** Additional class name */
  className?: string;
}

/**
 * Multi-select dropdown component for FilterBar.
 *
 * @example
 * ```tsx
 * <FilterBar.MultiSelect
 *   icon={Cpu}
 *   label="Platform"
 *   options={platforms}
 *   selected={selectedPlatforms}
 *   onToggle={togglePlatform}
 *   onClear={clearPlatformFilter}
 *   searchable
 * />
 * ```
 */
export function FilterMultiSelect<T extends string>({
  icon: Icon = Filter,
  label,
  options,
  selected,
  onToggle,
  onClear,
  searchable = false,
  searchPlaceholder = "Search...",
  renderOption,
  className,
}: FilterMultiSelectProps<T>) {
  const [search, setSearch] = useState("");
  const hasSelection = selected.size > 0;

  const filteredOptions = searchable
    ? options.filter((opt) => (renderOption?.(opt) ?? opt).toLowerCase().includes(search.toLowerCase()))
    : options;

  const getLabel = (option: T) => renderOption?.(option) ?? option;

  // Single option: show as informational only
  if (options.length <= 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={cn("gap-1.5", className)}
      >
        <Icon
          className="h-3.5 w-3.5"
          aria-hidden="true"
        />
        {options.length === 1 ? getLabel(options[0]) : label}
      </Button>
    );
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={hasSelection ? `${label}: ${selected.size} selected` : `Filter by ${label}`}
          className={cn(
            "gap-1.5",
            hasSelection && "border-[var(--nvidia-green)] bg-[var(--nvidia-green)]/5",
            className,
          )}
        >
          <Icon
            className="h-3.5 w-3.5"
            aria-hidden="true"
          />
          {label}
          {hasSelection && (
            <span
              className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--nvidia-green)] px-1 text-[10px] font-semibold text-white"
              aria-hidden="true"
            >
              {selected.size}
            </span>
          )}
          <ChevronDown
            className="h-3.5 w-3.5 opacity-50"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64"
      >
        {/* Search input */}
        {searchable && (
          <>
            <div className="px-2 pb-2">
              <div className="relative">
                <Search
                  className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full rounded-md border border-zinc-200 bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <DropdownMenuSeparator className="my-1" />
          </>
        )}

        {/* Options list */}
        <div className="max-h-48 overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-zinc-500">No options found</div>
          ) : (
            filteredOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                checked={selected.has(option)}
                onCheckedChange={() => onToggle(option)}
                onSelect={(e) => e.preventDefault()}
              >
                {getLabel(option)}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </div>

        {/* Clear selection */}
        {hasSelection && onClear && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClear}
              className="text-zinc-500 dark:text-zinc-400"
            >
              Clear selection
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
