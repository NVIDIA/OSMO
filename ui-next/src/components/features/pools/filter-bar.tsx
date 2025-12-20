// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Search, X, ChevronDown, Filter, Cpu, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { clearButton, chip } from "@/lib/styles";
import type { ActiveFilter } from "@/headless";
import type { ResourceType } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

interface FilterBarProps {
  // Search
  search: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;

  // Platform filter
  platforms: string[];
  selectedPlatforms: Set<string>;
  onTogglePlatform: (platform: string) => void;
  onClearPlatformFilter: () => void;

  // Resource type filter
  resourceTypes: ResourceType[];
  selectedResourceTypes: Set<ResourceType>;
  onToggleResourceType: (type: ResourceType) => void;
  onClearResourceTypeFilter: () => void;

  // Active filters
  activeFilters: ActiveFilter[];
  onRemoveFilter: (filter: ActiveFilter) => void;
  onClearAllFilters: () => void;

  // Counts
  totalCount: number;
  filteredCount: number;
}

// =============================================================================
// Components
// =============================================================================

/**
 * Unified filter bar with search, dropdowns, and active filter chips.
 *
 * Provides a consistent filtering interface that combines:
 * - Free-text search
 * - Platform multi-select dropdown
 * - Resource type multi-select dropdown
 * - Active filter chips with removal
 */
export function FilterBar({
  search,
  onSearchChange,
  onClearSearch,
  platforms,
  selectedPlatforms,
  onTogglePlatform,
  onClearPlatformFilter,
  resourceTypes,
  selectedResourceTypes,
  onToggleResourceType,
  onClearResourceTypeFilter,
  activeFilters,
  onRemoveFilter,
  onClearAllFilters,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  const hasSearch = search.length > 0;
  const hasFilters = activeFilters.length > 0;
  const hasPlatformFilter = selectedPlatforms.size > 0;
  const hasResourceTypeFilter = selectedResourceTypes.size > 0;
  const showingFiltered = hasFilters && filteredCount !== totalCount;

  return (
    <div className="space-y-3">
      {/* Filter controls row */}
      <div className="flex items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-9 pr-8 text-sm"
          />
          {hasSearch && (
            <button
              onClick={onClearSearch}
              className={cn("absolute right-2 top-1/2 -translate-y-1/2", clearButton)}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Platform dropdown */}
        {platforms.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5",
                  hasPlatformFilter && "border-[var(--nvidia-green)] bg-[var(--nvidia-green)]/5"
                )}
              >
                <Cpu className="h-3.5 w-3.5" />
                Platform
                {hasPlatformFilter && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--nvidia-green)] px-1 text-[10px] font-semibold text-white">
                    {selectedPlatforms.size}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {platforms.map((platform) => (
                <DropdownMenuCheckboxItem
                  key={platform}
                  checked={selectedPlatforms.has(platform)}
                  onCheckedChange={() => onTogglePlatform(platform)}
                >
                  {platform}
                </DropdownMenuCheckboxItem>
              ))}
              {hasPlatformFilter && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onClearPlatformFilter}
                    className="text-zinc-500 dark:text-zinc-400"
                  >
                    Clear selection
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Resource Type dropdown */}
        {resourceTypes.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5",
                  hasResourceTypeFilter && "border-[var(--nvidia-green)] bg-[var(--nvidia-green)]/5"
                )}
              >
                <Box className="h-3.5 w-3.5" />
                Type
                {hasResourceTypeFilter && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--nvidia-green)] px-1 text-[10px] font-semibold text-white">
                    {selectedResourceTypes.size}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {resourceTypes.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={selectedResourceTypes.has(type)}
                  onCheckedChange={() => onToggleResourceType(type)}
                >
                  {type}
                </DropdownMenuCheckboxItem>
              ))}
              {hasResourceTypeFilter && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onClearResourceTypeFilter}
                    className="text-zinc-500 dark:text-zinc-400"
                  >
                    Clear selection
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Results count */}
        <div className="ml-auto text-sm text-zinc-500 dark:text-zinc-400">
          {showingFiltered ? (
            <span>
              {filteredCount} of {totalCount} nodes
            </span>
          ) : (
            <span>{totalCount} nodes</span>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-zinc-400" />
          {activeFilters.map((filter) => (
            <button
              key={`${filter.type}-${filter.value}`}
              onClick={() => onRemoveFilter(filter)}
              className={cn(
                "group flex items-center gap-1.5 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs transition-colors",
                chip.selected
              )}
            >
              <span>{getFilterLabel(filter)}</span>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 transition-colors group-hover:bg-black/20 dark:bg-white/10 dark:group-hover:bg-white/20">
                <X className="h-2.5 w-2.5" />
              </span>
            </button>
          ))}
          {activeFilters.length > 1 && (
            <button
              onClick={onClearAllFilters}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getFilterLabel(filter: ActiveFilter): string {
  switch (filter.type) {
    case "search":
      return `Search: ${filter.label}`;
    case "platform":
      return filter.label;
    case "resourceType":
      return filter.label;
    default:
      return filter.label;
  }
}


