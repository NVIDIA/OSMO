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
 * ShellPortalContext
 *
 * Provides a portal target for shell terminal rendering.
 * This allows ShellContainer (rendered at workflow level for persistence)
 * to portal into the correct position within TaskDetails' tab content area.
 *
 * Flow:
 * 1. WorkflowDetailContent wraps content with ShellPortalProvider
 * 2. TaskDetails sets the portal target when shell tab is rendered
 * 3. ShellContainer portals into the target, respecting tab boundaries
 */

"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

interface ShellPortalContextValue {
  /** The current portal target element (set by TaskDetails) */
  portalTarget: HTMLElement | null;
  /** Register a portal target (called by TaskDetails when shell tab renders) */
  setPortalTarget: (element: HTMLElement | null) => void;
}

// =============================================================================
// Context
// =============================================================================

const ShellPortalContext = createContext<ShellPortalContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function ShellPortalProvider({ children }: { children: ReactNode }) {
  const [portalTarget, setPortalTargetState] = useState<HTMLElement | null>(null);

  const setPortalTarget = useCallback((element: HTMLElement | null) => {
    setPortalTargetState(element);
  }, []);

  return (
    <ShellPortalContext.Provider value={{ portalTarget, setPortalTarget }}>{children}</ShellPortalContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useShellPortal(): ShellPortalContextValue {
  const context = useContext(ShellPortalContext);
  if (!context) {
    throw new Error("useShellPortal must be used within a ShellPortalProvider");
  }
  return context;
}
