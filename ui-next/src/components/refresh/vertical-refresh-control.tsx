//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

"use client";

import { RefreshCw, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { useRefreshControlState } from "@/components/refresh/use-refresh-control-state";
import type { RefreshControlProps } from "@/components/refresh/types";
import { INTERVAL_OPTIONS } from "@/components/refresh/types";

/** Vertical refresh control for narrow edge strips. SSR-safe. */
export function VerticalRefreshControl(props: RefreshControlProps) {
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

  // SSR placeholder
  if (!mounted) {
    if (!hasAutoRefresh) {
      return (
        <button
          disabled
          className="size-8 rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
        >
          <RefreshCw className="mx-auto size-4 text-zinc-400" />
        </button>
      );
    }

    return (
      <div className="flex w-8 flex-col">
        <button
          disabled
          className="size-8 rounded-lg bg-transparent"
        >
          <RefreshCw className="mx-auto size-4 text-zinc-400" />
        </button>
        <button
          disabled
          className="-mt-1 h-4 w-full rounded-md bg-transparent"
        >
          <ChevronDown className="mx-auto size-2.5 text-zinc-500" />
        </button>
      </div>
    );
  }

  if (!hasAutoRefresh) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
              "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
              "transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RefreshCw
              className={cn(
                "size-4",
                isRefreshing ? "animate-spin" : "transition-transform duration-1000 ease-in-out will-change-transform",
              )}
              style={!isRefreshing ? { transform: `rotate(${clickCount * 360}deg)` } : undefined}
              aria-hidden="true"
            />
            <span className="sr-only">Refresh workflow</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{isRefreshing ? "Refreshing..." : "Refresh workflow"}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex w-8 flex-col">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
              "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
              "transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RefreshCw
              className={cn(
                "size-4",
                isRefreshing ? "animate-spin" : "transition-transform duration-1000 ease-in-out will-change-transform",
              )}
              style={!isRefreshing ? { transform: `rotate(${clickCount * 360}deg)` } : undefined}
              aria-hidden="true"
            />
            <span className="sr-only">Refresh workflow</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{isRefreshing ? "Refreshing..." : "Refresh workflow"}</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isRefreshing}
            aria-label={`Auto-refresh: ${isAutoRefreshActive ? intervalLabel : "Off"}`}
            className={cn(
              "-mt-1 flex h-4 w-full items-center justify-center rounded-md",
              "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600",
              "dark:text-zinc-500 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-400",
              "transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isAutoRefreshActive ? (
              <span
                className="text-[9px] font-medium"
                aria-hidden="true"
              >
                {intervalLabel}
              </span>
            ) : (
              <ChevronDown
                className="size-2.5"
                aria-hidden="true"
              />
            )}
            <span className="sr-only">Auto-refresh settings</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          side="top"
          className="w-56"
        >
          <div className="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Auto-refresh interval</div>
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
