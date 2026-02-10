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

import { RefreshCw, ChevronDown } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { useRefreshControlState } from "@/hooks/use-refresh-control-state";
import type { RefreshControlProps } from "@/components/refresh/types";
import { INTERVAL_OPTIONS } from "@/components/refresh/types";

export type { RefreshControlProps } from "@/components/refresh/types";

/** Horizontal refresh control for data table toolbars. SSR-safe. */
export function RefreshControl(props: RefreshControlProps) {
  const { isRefreshing } = props;
  const {
    mounted,
    clickCount,
    handleRefresh,
    hasAutoRefresh,
    intervalLabel,
    isAutoRefreshActive,
    dropdownValue,
    handleIntervalChange,
  } = useRefreshControlState(props);

  if (!mounted) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="h-8 w-8 p-0"
      >
        <RefreshCw className="h-4 w-4" />
        <span className="sr-only">Refresh</span>
      </Button>
    );
  }

  if (!hasAutoRefresh) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 w-8 p-0"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                isRefreshing ? "animate-spin" : "transition-transform duration-1000 ease-in-out will-change-transform",
              )}
              style={!isRefreshing ? { transform: `rotate(${clickCount * 360}deg)` } : undefined}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh data</TooltipContent>
      </Tooltip>
    );
  }

  const autoRefreshLabel = isAutoRefreshActive
    ? `Refresh data (auto-refresh: ${intervalLabel})`
    : "Refresh data (auto-refresh: Off)";

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 rounded-r-none border-r-0 px-2"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                isRefreshing ? "animate-spin" : "transition-transform duration-1000 ease-in-out will-change-transform",
              )}
              style={!isRefreshing ? { transform: `rotate(${clickCount * 360}deg)` } : undefined}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{autoRefreshLabel}</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isRefreshing}
                className="h-8 w-5 rounded-l-none p-0"
              >
                <ChevronDown className="h-3 w-3" />
                <span className="sr-only">Auto-refresh options</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Auto-refresh settings</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="end"
          className="w-56"
        >
          <div className="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Refresh interval</div>
          <DropdownMenuRadioGroup
            value={dropdownValue}
            onValueChange={handleIntervalChange}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <DropdownMenuRadioItem
                key={opt.value}
                value={opt.value}
              >
                {opt.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
