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

"use client";

import { useState, useMemo, memo, useCallback, useId } from "react";
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
import { Button } from "@/components/shadcn/button";
import type { Pool } from "@/lib/api/adapter/types";
import { cn } from "@/lib/utils";
import { PoolStatusBadge } from "@/components/workflow/pool-status-badge";

export interface PoolSelectProps {
  value: string;
  onValueChange: (poolName: string) => void;
  /** Pool metadata for displaying status badge in the trigger button */
  selectedPool?: Pool;
  /** When provided, populates the dropdown list; undefined shows a loading state */
  allPools?: Pool[];
  /** Notifies parent when dropdown opens (to trigger lazy pool fetch) */
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

export const PoolSelect = memo(function PoolSelect({
  value,
  onValueChange,
  selectedPool,
  allPools,
  onDropdownOpenChange,
}: PoolSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      onDropdownOpenChange?.(open);
    },
    [onDropdownOpenChange],
  );

  const pools = useMemo(() => allPools ?? [], [allPools]);
  const isLoading = !allPools && isOpen;

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
          aria-controls={listId}
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
              <PoolStatusBadge status={selectedPool.status} />
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
          <CommandList id={listId}>
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
                        <PoolStatusBadge status={pool.status} />
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
