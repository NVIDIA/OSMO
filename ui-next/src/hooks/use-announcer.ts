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
 * useAnnouncer Hook
 *
 * Provides screen reader announcements via aria-live regions.
 * Creates an invisible live region that screen readers will announce.
 *
 * This is a critical accessibility utility for dynamic content changes
 * that need to be communicated to screen reader users.
 *
 * @example
 * ```tsx
 * const announce = useAnnouncer();
 *
 * // Polite announcement (waits for screen reader to finish current task)
 * announce("Panel opened");
 *
 * // Assertive announcement (interrupts current speech)
 * announce("Error occurred", "assertive");
 * ```
 *
 * @example Custom region ID for multiple announcers
 * ```tsx
 * const announceNav = useAnnouncer({ id: "nav-announcer" });
 * const announceMain = useAnnouncer({ id: "main-announcer" });
 * ```
 *
 * ## Accessibility Notes
 * - Use "polite" (default) for most announcements
 * - Use "assertive" sparingly, only for critical/urgent information
 * - Keep messages concise and informative
 * - Avoid announcing too frequently (can overwhelm users)
 *
 * ## shadcn/ui Alternative
 * Consider using `@radix-ui/react-announce` for more advanced use cases.
 */

import { useCallback, useEffect, useRef } from "react";

// ============================================================================
// Types
// ============================================================================

/** Politeness level for aria-live regions */
export type AnnouncerPoliteness = "polite" | "assertive";

/** Options for the useAnnouncer hook */
export interface UseAnnouncerOptions {
  /**
   * Unique ID for the announcer region.
   * Useful when multiple announcers are needed in the same app.
   * @default "sr-announcer"
   */
  id?: string;
  /**
   * Default politeness level for announcements.
   * @default "polite"
   */
  defaultPoliteness?: AnnouncerPoliteness;
}

/** Function to announce a message to screen readers */
export type AnnounceFunction = (message: string, politeness?: AnnouncerPoliteness) => void;

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to announce messages to screen readers via aria-live regions.
 *
 * Creates and manages an invisible aria-live region that screen readers
 * will monitor and announce when content changes.
 *
 * @param options - Configuration options
 * @returns A function to announce messages
 */
export function useAnnouncer(options: UseAnnouncerOptions = {}): AnnounceFunction {
  const { id = "sr-announcer", defaultPoliteness = "polite" } = options;

  const regionRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create live region on mount
  useEffect(() => {
    // Check if region already exists (handles React StrictMode double-mount)
    let region = document.getElementById(id) as HTMLDivElement | null;

    if (!region) {
      region = document.createElement("div");
      region.id = id;
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", defaultPoliteness);
      region.setAttribute("aria-atomic", "true");

      // Visually hidden but accessible to screen readers
      // Using clip-path approach (modern, works well with all screen readers)
      Object.assign(region.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: "0",
      });

      document.body.appendChild(region);
    }

    regionRef.current = region;

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Note: We don't remove the region on unmount as it may be reused
      // by other components. Call cleanupAnnouncer() explicitly if needed.
    };
  }, [id, defaultPoliteness]);

  // Announce function - stable reference via useCallback
  const announce = useCallback<AnnounceFunction>(
    (message: string, politeness: AnnouncerPoliteness = defaultPoliteness) => {
      const region = regionRef.current;
      if (!region) return;

      // Update politeness if different from current
      if (region.getAttribute("aria-live") !== politeness) {
        region.setAttribute("aria-live", politeness);
      }

      // Clear previous message first (forces re-announcement of same message)
      region.textContent = "";

      // Set new message after a brief delay (ensures screen reader picks up change)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        region.textContent = message;
      }, 50);
    },
    [defaultPoliteness],
  );

  return announce;
}

// ============================================================================
// Cleanup Utility
// ============================================================================

/**
 * Cleanup function to remove an announcer region from the DOM.
 * Call this when the entire app/section using the announcer is fully unmounted.
 *
 * @param id - The ID of the announcer region to remove (default: "sr-announcer")
 */
export function cleanupAnnouncer(id: string = "sr-announcer"): void {
  const region = document.getElementById(id);
  if (region) {
    region.remove();
  }
}
