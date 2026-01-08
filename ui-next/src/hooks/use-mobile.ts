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

import { useState, useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Get current mobile state from window width.
 */
function getIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Subscribe to window resize events for mobile detection.
 */
function subscribeMobile(callback: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * Hook to detect if the viewport is mobile-sized.
 * Used by shadcn/ui Sidebar for responsive behavior.
 *
 * Uses useSyncExternalStore for proper React 18+ integration
 * with external browser APIs.
 */
export function useIsMobile(): boolean {
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getIsMobile,
    () => false, // Server snapshot - assume not mobile during SSR
  );

  return isMobile;
}

/**
 * Hook to detect if the user is on macOS.
 * Uses lazy initialization to avoid cascading renders.
 */
export function useIsMac(): boolean {
  const [isMac] = useState(() => {
    if (typeof navigator === "undefined") return false;
    return navigator.platform.toUpperCase().includes("MAC");
  });

  return isMac;
}
