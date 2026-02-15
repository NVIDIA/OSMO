//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Hook for FilterBar keyboard shortcuts and focus management.
 *
 * Implements:
 * - Cmd+F / Ctrl+F to focus the filter bar
 * - Automatic focus return on Escape (handled by FilterBar internally)
 *
 * Usage:
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const filterBarRef = useRef<FilterBarHandle>(null);
 * const { containerProps } = useFilterBarShortcut(containerRef, filterBarRef);
 *
 * return (
 *   <div ref={containerRef} {...containerProps}>
 *     <FilterBar ref={filterBarRef} ... />
 *     ...
 *   </div>
 * );
 * ```
 */

import { useEffect, type RefObject } from "react";
import { useAnnouncer } from "@/hooks/use-announcer";
import type { FilterBarHandle } from "@/components/filter-bar/filter-bar";

interface UseFilterBarShortcutReturn {
  /** Props to spread on the container element */
  containerProps: {
    tabIndex: number;
    style: { outline: string };
  };
}

// Hoisted constant to avoid recreating on every render
const CONTAINER_PROPS = {
  tabIndex: -1, // Make container focusable but not in tab order
  style: { outline: "none" } as const, // Remove focus outline
} as const;

/**
 * Adds Cmd+F keyboard shortcut to focus a FilterBar.
 *
 * @param containerRef - Ref to the container element (for focus return)
 * @param filterBarRef - Ref to the FilterBar component
 * @returns Props to spread on the container element
 */
export function useFilterBarShortcut(
  containerRef: RefObject<HTMLElement | null>,
  filterBarRef: RefObject<FilterBarHandle | null>,
): UseFilterBarShortcutReturn {
  const announce = useAnnouncer();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+F (Mac) or Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault(); // Prevent browser's native find
        filterBarRef.current?.focus();
        announce("Search focused. Press Escape to return.", "polite");
      }
    };

    // Only listen when container is mounted
    const container = containerRef.current;
    if (container) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [containerRef, filterBarRef, announce]);

  return { containerProps: CONTAINER_PROPS };
}
