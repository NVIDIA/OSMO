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

"use client";

import { useState, useRef, useMemo, useCallback, useEffect, useId } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
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

/** Threshold for switching to searchable mode */
const SEARCH_THRESHOLD = 6;

interface PlatformSelectorProps {
  platforms: string[];
  defaultPlatform: string | null;
  selectedPlatform: string | null;
  onSelectPlatform: (platform: string) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Platform Selector - Adaptive dropdown for platform selection.
 *
 * Behavior adapts to platform count:
 * - 1 platform: Static label (no dropdown)
 * - 2-5 platforms: Simple dropdown
 * - 6+ platforms: Searchable dropdown with filtering
 */
export function PlatformSelector({
  platforms,
  defaultPlatform,
  selectedPlatform,
  onSelectPlatform,
}: PlatformSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const searchInputId = useId();

  const sortedPlatforms = useMemo(() => [...platforms].sort(), [platforms]);
  const isDefault = selectedPlatform === defaultPlatform;

  // Filter platforms by search query (only used for 6+ platforms)
  const filteredPlatforms = useMemo(() => {
    if (!searchQuery) return sortedPlatforms;
    const q = searchQuery.toLowerCase();
    return sortedPlatforms.filter((p) => p.toLowerCase().includes(q));
  }, [sortedPlatforms, searchQuery]);

  // Handle dropdown open/close
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
    }
  }, []);

  // Focus search input and scroll current item into view when dropdown opens
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
      const currentItem = listContainerRef.current?.querySelector('[data-current="true"]');
      if (currentItem) {
        currentItem.scrollIntoView({ block: "center", behavior: "instant" });
      }
    }
  }, [isOpen]);

  // Single platform: Static label
  if (platforms.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{platforms[0]}</span>
        {defaultPlatform === platforms[0] && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
            default
          </span>
        )}
      </div>
    );
  }

  // 2-5 platforms: Simple dropdown
  if (platforms.length < SEARCH_THRESHOLD) {
    return (
      <DropdownMenu
        open={isOpen}
        onOpenChange={handleOpenChange}
      >
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
            aria-label="Select platform"
          >
            <span className="text-sm font-medium">{selectedPlatform}</span>
            {isDefault && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                default
              </span>
            )}
            <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
        >
          {sortedPlatforms.map((platform) => {
            const isCurrent = platform === selectedPlatform;
            const isPlatformDefault = platform === defaultPlatform;
            return (
              <DropdownMenuItem
                key={platform}
                onSelect={() => {
                  onSelectPlatform(platform);
                }}
                className={cn("flex items-center gap-2", isCurrent && "bg-zinc-100 dark:bg-zinc-800")}
              >
                <span className={cn("flex-1 truncate", isCurrent && "font-medium")}>{platform}</span>
                {isPlatformDefault && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                    default
                  </span>
                )}
                {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // 6+ platforms: Searchable dropdown
  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md py-0.5 pr-1 text-zinc-900 transition-colors hover:bg-zinc-200/50 dark:text-zinc-100 dark:hover:bg-zinc-700/50"
          aria-label="Select platform"
        >
          <span className="text-sm font-medium">{selectedPlatform}</span>
          {isDefault && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              default
            </span>
          )}
          <ChevronDown className="size-3.5 text-zinc-500 dark:text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 p-0"
      >
        {/* Search input */}
        <div className="flex items-center border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <label
            htmlFor={searchInputId}
            className="sr-only"
          >
            Search platforms
          </label>
          <Search className="mr-2 size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
          <input
            ref={searchInputRef}
            id={searchInputId}
            type="text"
            placeholder="Search platforms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Search platforms"
            onKeyDown={(e) => {
              // Stop propagation for navigation keys (let Escape bubble to close dropdown)
              if (e.key !== "Escape") {
                e.stopPropagation();
              }
            }}
          />
        </div>
        {/* Platform list */}
        <div
          ref={listContainerRef}
          className="max-h-60 overflow-y-auto py-1"
        >
          {filteredPlatforms.length === 0 ? (
            <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-500">No platforms found</div>
          ) : (
            filteredPlatforms.map((platform) => {
              const isCurrent = platform === selectedPlatform;
              const isPlatformDefault = platform === defaultPlatform;
              return (
                <DropdownMenuItem
                  key={platform}
                  data-current={isCurrent ? "true" : undefined}
                  onSelect={() => {
                    onSelectPlatform(platform);
                    setSearchQuery("");
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2",
                    isCurrent && "bg-zinc-100/50 dark:bg-zinc-800/50",
                  )}
                >
                  <span className={cn("flex-1 truncate text-sm", isCurrent && "font-medium")}>{platform}</span>
                  {isPlatformDefault && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                      default
                    </span>
                  )}
                  {isCurrent && <Check className="size-4 shrink-0 text-emerald-500" />}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
