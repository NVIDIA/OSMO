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
 * Hook for managing workflow details sidebar collapsed state.
 * Persists user preference to localStorage.
 */

"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "workflow-details-sidebar-collapsed";

export function useSidebarCollapsed() {
  // Initialize with false (expanded), will sync with localStorage in useEffect
  const [collapsed, setCollapsed] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Sync with localStorage on mount (client-side only)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setCollapsed(true);
    }
    setIsHydrated(true);
  }, []);

  // Toggle function that persists to localStorage
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Explicit setters
  const expand = useCallback(() => {
    setCollapsed(false);
    localStorage.setItem(STORAGE_KEY, "false");
  }, []);

  const collapse = useCallback(() => {
    setCollapsed(true);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  return {
    collapsed,
    isHydrated,
    toggle,
    expand,
    collapse,
  };
}
