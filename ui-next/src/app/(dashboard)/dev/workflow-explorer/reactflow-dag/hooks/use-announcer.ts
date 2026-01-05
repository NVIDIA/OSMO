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
 * useAnnouncer Hook
 *
 * Provides screen reader announcements via aria-live regions.
 * Creates an invisible live region that screen readers will announce.
 *
 * Usage:
 * ```tsx
 * const announce = useAnnouncer();
 * announce("Panel opened"); // Polite announcement
 * announce("Error occurred", "assertive"); // Assertive announcement
 * ```
 */

import { useCallback, useEffect, useRef } from "react";

type Politeness = "polite" | "assertive";

/**
 * Hook to announce messages to screen readers.
 * Creates and manages an aria-live region.
 */
export function useAnnouncer() {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Create live region on mount
  useEffect(() => {
    // Check if region already exists (for StrictMode double-mount)
    let region = document.getElementById("dag-announcer") as HTMLDivElement | null;

    if (!region) {
      region = document.createElement("div");
      region.id = "dag-announcer";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      // Visually hidden but accessible to screen readers
      Object.assign(region.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
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
      // Don't remove region on unmount - may be reused
    };
  }, []);

  // Announce function
  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const region = regionRef.current;
    if (!region) return;

    // Update politeness if needed
    if (region.getAttribute("aria-live") !== politeness) {
      region.setAttribute("aria-live", politeness);
    }

    // Clear previous message first (forces re-announcement)
    region.textContent = "";

    // Set new message after a brief delay (ensures re-announcement)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      region.textContent = message;
    }, 50);
  }, []);

  return announce;
}

/**
 * Cleanup function to remove the announcer region.
 * Call this when the DAG is fully unmounted.
 */
export function cleanupAnnouncer(): void {
  const region = document.getElementById("dag-announcer");
  if (region) {
    region.remove();
  }
}
