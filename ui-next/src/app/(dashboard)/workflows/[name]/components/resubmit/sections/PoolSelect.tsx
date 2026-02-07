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
import { Check, ChevronsUpDown, Loader2, CheckCircle2, Wrench, XCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/shadcn/command";
import { Button } from "@/components/shadcn/button";
import { useGetPoolQuotasApiPoolQuotaGet } from "@/lib/api/generated";
import { transformPoolsResponse } from "@/lib/api/adapter/transforms";
import type { Pool } from "@/lib/api/adapter/types";
import { cn } from "@/lib/utils";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "@/app/(dashboard)/pools/lib/constants";

export interface PoolSelectProps {
  /** Currently selected pool name (from workflow's original pool) */
  value: string;
  /** Callback when pool selection changes */
  onValueChange: (poolName: string) => void;
  /** Selected pool metadata (for displaying badge in trigger) */
  selectedPool?: Pool;
}

/** Status icons mapping (matches pools table) */
const STATUS_ICONS = {
  online: CheckCircle2,
  maintenance: Wrench,
  offline: XCircle,
} as const;

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
              {(() => {
                const { category, label } = getStatusDisplay(selectedPool.status);
                const styles = STATUS_STYLES[category]?.badge;
                const Icon = STATUS_ICONS[category as StatusCategory];

                if (!styles) return null;

                return (
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5", styles.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", styles.icon)} />
                    <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
                  </span>
                );
              })()}
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
                  {pools.map((pool) => {
                    const { category, label } = getStatusDisplay(pool.status);
                    const styles = STATUS_STYLES[category]?.badge;
                    const Icon = STATUS_ICONS[category as StatusCategory];

                    return (
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
                          {styles && (
                            <span
                              className={cn("inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5", styles.bg)}
                            >
                              <Icon className={cn("h-3.5 w-3.5", styles.icon)} />
                              <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
