// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState } from "react";
import { Search, X, ChevronDown, Filter, Cpu, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { clearButton, chip } from "@/lib/styles";
import type { ActiveFilter, ResourceDisplayMode } from "@/headless";
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

  // Resource display mode
  resourceDisplayMode: ResourceDisplayMode;
  onResourceDisplayModeChange: (mode: ResourceDisplayMode) => void;

  // Active filters
  activeFilters: ActiveFilter[];
  onRemoveFilter: (filter: ActiveFilter) => void;
  onClearAllFilters: () => void;
}

// =============================================================================
// Components
// =============================================================================

/**
 * Platform dropdown with mini-search for long lists.
 */
function PlatformDropdown({
  platforms,
  selectedPlatforms,
  onTogglePlatform,
  onClearPlatformFilter,
  hasPlatformFilter,
}: {
  platforms: string[];
  selectedPlatforms: Set<string>;
  onTogglePlatform: (platform: string) => void;
  onClearPlatformFilter: () => void;
  hasPlatformFilter: boolean;
}) {
  const [platformSearch, setPlatformSearch] = useState("");

  const filteredPlatforms = platforms.filter((p) =>
    p.toLowerCase().includes(platformSearch.toLowerCase())
  );

  return (
    <DropdownMenu onOpenChange={(open) => !open && setPlatformSearch("")}>
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
      <DropdownMenuContent align="start" className="w-64">
        {platforms.length === 1 ? (
          // Single platform: show as informational
          <DropdownMenuItem disabled className="opacity-100">
            {platforms[0]}
          </DropdownMenuItem>
        ) : (
          <>
            {/* Mini search */}
            <div className="px-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search platforms..."
                  value={platformSearch}
                  onChange={(e) => setPlatformSearch(e.target.value)}
                  className="h-8 w-full rounded-md border border-zinc-200 bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
            <DropdownMenuSeparator className="my-1" />

            {/* Platform list */}
            <div className="max-h-48 overflow-y-auto">
              {filteredPlatforms.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-zinc-500">
                  No platforms found
                </div>
              ) : (
                filteredPlatforms.map((platform) => (
                  <DropdownMenuCheckboxItem
                    key={platform}
                    checked={selectedPlatforms.has(platform)}
                    onCheckedChange={() => onTogglePlatform(platform)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {platform}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </div>

            {/* Clear selection */}
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  resourceDisplayMode,
  onResourceDisplayModeChange,
  activeFilters,
  onRemoveFilter,
  onClearAllFilters,
}: FilterBarProps) {
  const hasSearch = search.length > 0;
  const hasFilters = activeFilters.length > 0;
  const hasPlatformFilter = selectedPlatforms.size > 0;
  const hasResourceTypeFilter = selectedResourceTypes.size > 0;

  return (
    <div className="space-y-3">
      {/* Filter controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
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
          <PlatformDropdown
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            onTogglePlatform={onTogglePlatform}
            onClearPlatformFilter={onClearPlatformFilter}
            hasPlatformFilter={hasPlatformFilter}
          />
        )}

        {/* Resource Type dropdown (single-select) */}
        {resourceTypes.length > 0 && (
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
              {resourceTypes.length === 1 ? (
                // Single type: show as informational, no filtering needed
                <DropdownMenuItem disabled className="opacity-100">
                  {resourceTypes[0]}
                </DropdownMenuItem>
              ) : (
                // Multiple types: show as single-select radio items
                <DropdownMenuRadioGroup
                  value={[...selectedResourceTypes][0] ?? ""}
                  onValueChange={(value) => onToggleResourceType(value as ResourceType)}
                >
                  {resourceTypes.map((type) => (
                    <DropdownMenuRadioItem key={type} value={type}>
                      {type}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* View by toggle (right side) */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">View by:</span>
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
            <button
              onClick={() => onResourceDisplayModeChange("free")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                resourceDisplayMode === "free"
                  ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              Free
            </button>
            <button
              onClick={() => onResourceDisplayModeChange("used")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                resourceDisplayMode === "used"
                  ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              Used
            </button>
          </div>
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
