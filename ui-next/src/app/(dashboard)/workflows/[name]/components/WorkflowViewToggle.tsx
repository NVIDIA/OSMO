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

import { memo } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Network, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSharedPreferences, useDagVisible } from "@/stores";

/**
 * WorkflowViewToggle - iOS-style sliding switch with icons for DAG visibility toggling.
 *
 * Design:
 * - Uses Radix Switch primitive for full accessibility
 * - Network icon (left) = DAG visible, List icon (right) = DAG hidden (table-only view)
 * - Larger thumb slides to cover/highlight the active icon
 * - Smooth 300ms transitions for polished UX
 * - Icons dim when inactive, brighten when active (under thumb)
 *
 * Hydration Safety:
 * Uses useDagVisible (hydration-safe) to prevent mismatch from
 * Zustand's localStorage persistence returning different values on server vs client.
 */
export const WorkflowViewToggle = memo(function WorkflowViewToggle() {
  // Hydration-safe: returns initial state during SSR/hydration, then actual value
  const dagVisible = useDagVisible();
  const toggleDagVisible = useSharedPreferences((s) => s.toggleDagVisible);

  const isDagHidden = !dagVisible;

  return (
    <div className="relative inline-flex items-center">
      <SwitchPrimitive.Root
        checked={isDagHidden}
        onCheckedChange={toggleDagVisible}
        aria-label={isDagHidden ? "DAG hidden. Show DAG view" : "DAG visible. Hide DAG view"}
        className={cn(
          // Base shape and sizing - wider than default for icons
          "relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full",
          // Background track styling
          "bg-zinc-200 dark:bg-zinc-700",
          // Border for definition
          "border border-zinc-300 dark:border-zinc-600",
          // Focus ring
          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none",
          "dark:focus-visible:ring-offset-zinc-900",
          // Transition for background color changes
          "transition-colors duration-300",
          // Disabled state
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {/* Left icon (DAG/Network) - positioned in track */}
        <span
          className={cn(
            "absolute left-2 z-10 flex size-4 items-center justify-center",
            "transition-colors duration-300",
            // When DAG hidden (checked), DAG icon is visible and muted
            // When DAG visible (unchecked), icon is under thumb - muted too but thumb shows icon
            isDagHidden ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400/50 dark:text-zinc-600",
          )}
          aria-hidden="true"
        >
          <Network className="size-4" />
        </span>

        {/* Right icon (Table/List) - positioned in track */}
        <span
          className={cn(
            "absolute right-2 z-10 flex size-4 items-center justify-center",
            "transition-colors duration-300",
            // When DAG visible (unchecked), Table icon is visible and muted
            // When DAG hidden (checked), icon is under thumb - muted too but thumb shows icon
            isDagHidden ? "text-zinc-400/50 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400",
          )}
          aria-hidden="true"
        >
          <List className="size-4" />
        </span>

        {/* Sliding thumb with active icon */}
        <SwitchPrimitive.Thumb
          className={cn(
            // Shape and size - larger to cover icons properly
            "pointer-events-none flex h-6 w-7 items-center justify-center rounded-full",
            // Thumb styling
            "bg-white shadow-md dark:bg-zinc-100",
            // Ring for definition
            "ring-1 ring-black/10 dark:ring-black/20",
            // Sliding animation - translateX based on state
            "transform transition-transform duration-300 ease-out",
            // Position: left margin for DAG (unchecked), right margin for Table (checked)
            "data-[state=unchecked]:translate-x-0.5",
            "data-[state=checked]:translate-x-[calc(100%+2px)]",
          )}
        >
          {/* Icon on the thumb - shows the active view */}
          {isDagHidden ? (
            <List className="size-4 text-zinc-700 dark:text-zinc-800" />
          ) : (
            <Network className="size-4 text-zinc-700 dark:text-zinc-800" />
          )}
        </SwitchPrimitive.Thumb>
      </SwitchPrimitive.Root>
    </div>
  );
});
