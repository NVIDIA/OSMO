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
 * View Transition Hook
 *
 * Provides a modern, smooth transition experience using the View Transitions API.
 * Falls back gracefully when the API is not supported (non-Chromium browsers).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
 *
 * @example
 * ```tsx
 * const { startTransition, isTransitioning } = useViewTransition();
 *
 * const handleFilterChange = (filter: string) => {
 *   startTransition(() => {
 *     setFilter(filter);
 *   });
 * };
 * ```
 */

"use client";

import { useCallback, useState, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the view transition.
 */
export interface UseViewTransitionOptions {
  /**
   * Skip the visual transition but still call the callback.
   * Useful for programmatic updates that shouldn't animate.
   */
  skipAnimation?: boolean;
}

/**
 * Return value from useViewTransition hook.
 */
export interface UseViewTransitionReturn {
  /**
   * Whether a view transition is currently in progress.
   */
  isTransitioning: boolean;

  /**
   * Whether the View Transitions API is supported.
   */
  isSupported: boolean;

  /**
   * Start a view transition with the given callback.
   * Falls back to calling the callback directly if API is not supported.
   *
   * @param callback - The DOM update function to transition
   * @param options - Optional configuration
   * @returns Promise that resolves when the transition completes
   */
  startTransition: (callback: () => void | Promise<void>, options?: UseViewTransitionOptions) => Promise<void>;

  /**
   * Skip any currently running transition.
   * Useful for interrupting on rapid user input.
   */
  skipTransition: () => void;
}

// =============================================================================
// Feature Detection
// =============================================================================

/**
 * Check if View Transitions API is supported.
 * Memoized at module level for performance.
 */
function isViewTransitionSupported(): boolean {
  if (typeof document === "undefined") return false;
  return "startViewTransition" in document && typeof document.startViewTransition === "function";
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for using the View Transitions API with graceful fallback.
 *
 * Features:
 * - Automatic fallback for unsupported browsers
 * - Respects `prefers-reduced-motion`
 * - Tracks transition state for loading indicators
 * - Supports skipping animations programmatically
 * - Handles rapid successive calls (interrupts previous)
 *
 * @returns View transition utilities
 */
export function useViewTransition(): UseViewTransitionReturn {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const currentTransitionRef = useRef<ViewTransition | null>(null);
  const isSupported = isViewTransitionSupported();

  const skipTransition = useCallback(() => {
    if (currentTransitionRef.current) {
      currentTransitionRef.current.skipTransition();
      currentTransitionRef.current = null;
      setIsTransitioning(false);
    }
  }, []);

  const startTransition = useCallback(
    async (callback: () => void | Promise<void>, options?: UseViewTransitionOptions): Promise<void> => {
      // Skip any currently running transition (rapid updates)
      skipTransition();

      // Check for reduced motion preference
      const prefersReducedMotion =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Fall back if API not supported, reduced motion preferred, or animation skipped
      if (!isSupported || prefersReducedMotion || options?.skipAnimation) {
        await callback();
        return;
      }

      try {
        setIsTransitioning(true);

        // Use the native startViewTransition API
        const transition = document.startViewTransition(() => {
          return Promise.resolve(callback());
        });

        currentTransitionRef.current = transition;

        // Wait for the transition to complete
        await transition.finished;
      } catch {
        // Transition was skipped or failed - that's okay
      } finally {
        currentTransitionRef.current = null;
        setIsTransitioning(false);
      }
    },
    [isSupported, skipTransition],
  );

  return {
    isTransitioning,
    isSupported,
    startTransition,
    skipTransition,
  };
}

// =============================================================================
// Utility: Inline View Transition (no hook needed)
// =============================================================================

/**
 * Execute a callback with View Transition if supported.
 * Use this for one-off transitions without needing the full hook.
 *
 * @param callback - The DOM update function to transition
 * @returns Promise that resolves when complete
 *
 * @example
 * ```tsx
 * import { withViewTransition } from "@/hooks";
 *
 * const handleTabChange = (tab: string) => {
 *   withViewTransition(() => setActiveTab(tab));
 * };
 * ```
 */
export async function withViewTransition(callback: () => void | Promise<void>): Promise<void> {
  // Check for reduced motion preference
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!isViewTransitionSupported() || prefersReducedMotion) {
    await callback();
    return;
  }

  try {
    // Use the native startViewTransition API
    const transition = document.startViewTransition(() => Promise.resolve(callback()));
    await transition.finished;
  } catch {
    // Transition was skipped - already executed callback
  }
}
