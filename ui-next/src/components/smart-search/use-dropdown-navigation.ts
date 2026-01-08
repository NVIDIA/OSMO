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

/**
 * Hook for managing dropdown navigation state and keyboard interactions.
 *
 * ⚠️  REPLACEABLE BY CMDK
 *
 * When using cmdk's Command component, this hook is NOT needed because
 * cmdk handles keyboard navigation (↑↓), focus management, and scroll-into-view
 * automatically via its internal state.
 *
 * This hook exists only for the current custom dropdown implementation.
 * When migrating to cmdk:
 * 1. Remove this hook usage from smart-search.tsx
 * 2. Use Command's onSelect and value props instead
 * 3. Delete this file
 */

import { useState, useCallback, useEffect, type RefObject } from "react";

export interface UseDropdownNavigationOptions {
  /** Total number of navigable items */
  totalNavigableCount: number;
  /** Number of preset items (for Tab behavior) */
  presetCount: number;
  /** Whether dropdown is open */
  isOpen: boolean;
  /** Callback to open dropdown */
  onOpen: () => void;
  /** Ref to the dropdown element for scroll-into-view */
  dropdownRef: RefObject<HTMLDivElement | null>;
}

export interface UseDropdownNavigationReturn {
  /** Currently highlighted index (-1 = nothing) */
  highlightedIndex: number;
  /** Set the highlighted index */
  setHighlightedIndex: (index: number) => void;
  /** Navigate down (wrap at end) */
  navigateDown: () => void;
  /** Navigate up (wrap at start) */
  navigateUp: () => void;
  /** Navigate to next item (for Tab key) */
  navigateNext: () => void;
  /** Reset highlighted index */
  resetHighlight: () => void;
  /** Check if highlighted item is a preset */
  isHighlightedPreset: () => boolean;
  /** Get the suggestion index from unified navigation index */
  getSuggestionIndex: (unifiedIndex: number) => number;
}

/**
 * Clamp highlighted index to valid range.
 * Returns -1 if index is out of bounds or count is 0.
 */
function clampIndex(index: number, count: number): number {
  if (count === 0 || index < 0) return -1;
  if (index >= count) return -1;
  return index;
}

/**
 * Hook for managing dropdown navigation with keyboard support.
 *
 * Features:
 * - Unified navigation across presets and suggestions
 * - Wrapping navigation (up from first goes to last)
 * - Auto-scroll highlighted item into view
 * - Automatic clamping when item count changes
 */
export function useDropdownNavigation({
  totalNavigableCount,
  presetCount,
  isOpen,
  onOpen,
  dropdownRef,
}: UseDropdownNavigationOptions): UseDropdownNavigationReturn {
  const [rawHighlightedIndex, setRawHighlightedIndex] = useState(-1);

  // Derive the effective highlighted index - clamp to valid range
  // This handles the case where items are removed and index becomes invalid
  const highlightedIndex = clampIndex(rawHighlightedIndex, totalNavigableCount);

  // Wrapper that validates before setting
  const setHighlightedIndex = useCallback((index: number) => {
    setRawHighlightedIndex(index);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !isOpen) return;

    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    const highlighted = dropdown.querySelector(`[data-highlight-index="${highlightedIndex}"]`);
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedIndex, dropdownRef, isOpen]);

  const navigateDown = useCallback(() => {
    if (totalNavigableCount === 0) return;

    if (!isOpen) {
      onOpen();
      setRawHighlightedIndex(0);
    } else {
      setRawHighlightedIndex((current) => {
        const clamped = clampIndex(current, totalNavigableCount);
        if (clamped === -1 || clamped >= totalNavigableCount - 1) {
          return 0; // Wrap to start
        }
        return clamped + 1;
      });
    }
  }, [totalNavigableCount, isOpen, onOpen]);

  const navigateUp = useCallback(() => {
    if (totalNavigableCount === 0) return;

    if (!isOpen) {
      onOpen();
      setRawHighlightedIndex(totalNavigableCount - 1);
    } else {
      setRawHighlightedIndex((current) => {
        const clamped = clampIndex(current, totalNavigableCount);
        if (clamped === -1 || clamped === 0) {
          return totalNavigableCount - 1; // Wrap to end
        }
        return clamped - 1;
      });
    }
  }, [totalNavigableCount, isOpen, onOpen]);

  const navigateNext = useCallback(() => {
    if (totalNavigableCount === 0) return;

    if (!isOpen) {
      onOpen();
      setRawHighlightedIndex(0);
    } else {
      setRawHighlightedIndex((current) => {
        const clamped = clampIndex(current, totalNavigableCount);
        if (clamped >= 0) {
          return (clamped + 1) % totalNavigableCount;
        }
        return 0;
      });
    }
  }, [totalNavigableCount, isOpen, onOpen]);

  const resetHighlight = useCallback(() => {
    setRawHighlightedIndex(-1);
  }, []);

  const isHighlightedPreset = useCallback(() => {
    return highlightedIndex >= 0 && highlightedIndex < presetCount;
  }, [highlightedIndex, presetCount]);

  const getSuggestionIndex = useCallback(
    (unifiedIndex: number) => {
      return unifiedIndex - presetCount;
    },
    [presetCount],
  );

  return {
    highlightedIndex,
    setHighlightedIndex,
    navigateDown,
    navigateUp,
    navigateNext,
    resetHighlight,
    isHighlightedPreset,
    getSuggestionIndex,
  };
}
