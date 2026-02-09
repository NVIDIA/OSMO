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

import { useEffect, useState } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

/**
 * localStorage key for enabling React Query Devtools.
 * Set to "true" to enable, anything else to disable.
 */
const DEVTOOLS_KEY = "osmo:devtools:enabled";

/**
 * Conditionally renders TanStack Query Devtools based on localStorage setting.
 *
 * ## Usage
 *
 * Toggle devtools visibility in the browser console:
 * ```js
 * // Enable devtools
 * window.toggleDevtools(true)
 *
 * // Disable devtools
 * window.toggleDevtools(false)
 *
 * // Toggle current state
 * window.toggleDevtools()
 * ```
 *
 * ## Implementation Details
 *
 * - Only renders if `localStorage.getItem("osmo:devtools:enabled") === "true"`
 * - SSR-safe: waits for hydration before checking localStorage
 * - Zero production bundle impact: devtools tree-shaken in production builds
 * - Console helper attached on mount for easy toggling
 *
 * @see {@link https://tanstack.com/query/latest/docs/react/devtools}
 */
export function QueryDevtools() {
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // After hydration, check localStorage
    setHydrated(true);
    const stored = localStorage.getItem(DEVTOOLS_KEY);
    setEnabled(stored === "true");

    // Create console helper
    const toggleDevtools = (enable?: boolean) => {
      const shouldEnable = enable ?? localStorage.getItem(DEVTOOLS_KEY) !== "true";
      localStorage.setItem(DEVTOOLS_KEY, String(shouldEnable));
      setEnabled(shouldEnable);

      console.log(
        `%c[OSMO DevTools] ${shouldEnable ? "✓ Enabled" : "✗ Disabled"}`,
        `color: ${shouldEnable ? "#10b981" : "#ef4444"}; font-weight: bold;`,
      );
    };

    // Attach to window for console access
    if (typeof window !== "undefined") {
      (window as unknown as { toggleDevtools: typeof toggleDevtools }).toggleDevtools = toggleDevtools;

      // Log availability on first load if not already enabled
      if (!enabled) {
        console.log(
          "%c[OSMO DevTools] TanStack Query Devtools available. Run window.toggleDevtools() to enable.",
          "color: #3b82f6; font-weight: bold;",
        );
      }
    }

    // Listen for storage events from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === DEVTOOLS_KEY) {
        setEnabled(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [enabled]);

  // Don't render until hydrated (SSR safety)
  if (!hydrated || !enabled) return null;

  return (
    <ReactQueryDevtools
      initialIsOpen={false}
      buttonPosition="bottom-right"
    />
  );
}
