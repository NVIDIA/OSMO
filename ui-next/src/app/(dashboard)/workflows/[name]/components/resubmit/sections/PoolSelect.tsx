// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * PoolSelect - Lazy-loading pool selection for resubmit drawer.
 *
 * Uses Popover + Command (cmdk) instead of Radix Select to avoid the
 * aria-hidden conflict with ResizablePanel. Radix Select sets aria-hidden
 * on ancestor elements when opened, which conflicts with the panel's
 * focus management. Popover does not exhibit this behavior.
 *
 * Lazy-loading strategy:
 * 1. On mount: Show preselected pool (workflow's original pool)
 * 2. On popover open: Fetch ALL pools, show loading indicator
 * 3. Pools load: Enable search via cmdk, populate list
 */

"use client";

import { useState, useMemo, memo, useCallback } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/shadcn/command";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { useGetPoolQuotasApiPoolQuotaGet } from "@/lib/api/generated";
import { transformPoolsResponse } from "@/lib/api/adapter/transforms";
import type { Pool } from "@/lib/api/adapter/types";
import { PoolStatus } from "@/lib/api/generated";
import { cn } from "@/lib/utils";

export interface PoolSelectProps {
  /** Currently selected pool name (from workflow's original pool) */
  value: string;
  /** Callback when pool selection changes */
  onValueChange: (poolName: string) => void;
  /** Selected pool metadata (for displaying badge in trigger) */
  selectedPool?: Pool;
}

/** Map pool status to color classes */
const STATUS_COLOR: Record<PoolStatus, string> = {
  [PoolStatus.ONLINE]:
    "bg-green-500/10 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800",
  [PoolStatus.MAINTENANCE]:
    "bg-yellow-500/10 text-yellow-700 border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-400 dark:border-yellow-800",
  [PoolStatus.OFFLINE]:
    "bg-red-500/10 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-400 dark:border-red-800",
};

/**
 * PoolSelect component using Popover + Command (cmdk) combobox pattern.
 *
 * This avoids the Radix Select aria-hidden conflict with ResizablePanel.
 * Radix Select sets aria-hidden on ancestor elements (including the panel),
 * which causes browser errors and immediately closes the dropdown. Popover
 * is inherently non-modal and does not modify ancestor aria attributes.
 *
 * Loading strategy:
 * 1. Initial render: Show preselected pool (passed via selectedPool prop)
 * 2. Popover open: Trigger pool fetch via TanStack Query
 * 3. During load: Show spinner in command list
 * 4. After load: cmdk handles search/filter natively
 */
export const PoolSelect = memo(function PoolSelect({ value, onValueChange, selectedPool }: PoolSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Track if popover has ever been opened, to keep the query enabled after close.
  // Once opened, the query stays enabled so TanStack Query can serve from cache
  // without refetching on subsequent opens (governed by staleTime/gcTime).
  const [hasEverOpened, setHasEverOpened] = useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && !hasEverOpened) {
        setHasEverOpened(true);
      }
    },
    [hasEverOpened],
  );

  // Lazy-load pools: only fetch once the dropdown has been opened at least once
  const { data: rawData, isLoading } = useGetPoolQuotasApiPoolQuotaGet(
    { all_pools: true },
    {
      query: {
        enabled: hasEverOpened,
        select: useCallback((rawData: unknown) => {
          if (!rawData) return { pools: [], sharingGroups: [] };
          return transformPoolsResponse(rawData);
        }, []),
      },
    },
  );

  // Memoize pools array to stabilize reference
  const pools = useMemo(() => rawData?.pools ?? [], [rawData]);

  const handleSelect = useCallback(
    (poolName: string) => {
      onValueChange(poolName);
      setIsOpen(false);
    },
    [onValueChange],
  );

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={isOpen}
          aria-label="Select target pool"
          className={cn(
            "h-auto min-h-[44px] w-full justify-between",
            "font-mono text-sm",
            "transition-colors duration-200",
          )}
        >
          {selectedPool ? (
            <div className="flex w-full items-center justify-between gap-2 py-1">
              <span className="truncate font-medium">{selectedPool.name}</span>
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[0.6875rem] font-medium uppercase", STATUS_COLOR[selectedPool.status])}
              >
                {selectedPool.status}
              </Badge>
            </div>
          ) : (
            <span className="text-muted-foreground">Select pool...</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={isLoading ? "Loading pools..." : "Search pools..."}
            disabled={isLoading}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <Loader2 className="text-muted-foreground size-6 animate-spin" />
                <span className="text-muted-foreground text-sm">Loading pools...</span>
              </div>
            ) : (
              <>
                <CommandEmpty>{pools.length === 0 ? "No pools available" : "No pools found"}</CommandEmpty>
                <CommandGroup>
                  {pools.map((pool) => (
                    <CommandItem
                      key={pool.name}
                      value={pool.name}
                      onSelect={handleSelect}
                      className="cursor-pointer font-mono"
                    >
                      <Check
                        className={cn("mr-2 size-4 shrink-0", value === pool.name ? "opacity-100" : "opacity-0")}
                      />
                      <div className="flex flex-1 items-center justify-between gap-3">
                        <span className="truncate font-medium">{pool.name}</span>
                        <Badge
                          variant="outline"
                          className={cn("shrink-0 text-[0.6875rem] font-medium uppercase", STATUS_COLOR[pool.status])}
                        >
                          {pool.status}
                        </Badge>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
