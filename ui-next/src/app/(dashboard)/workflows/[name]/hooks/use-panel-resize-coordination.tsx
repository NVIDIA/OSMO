//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

/**
 * Hook for coordinating with panel resize operations.
 *
 * This hook provides:
 * 1. isSuspended - Whether column sizing should be suspended
 * 2. Callback registration for layout stable notification
 *
 * Architecture:
 * - Uses callback registration (not events) for deterministic coordination
 * - Integrates with PanelResizeStateMachine via context
 *
 * Note: These hooks must be used within PanelResizeProvider.
 * Tables outside the provider should not use these hooks.
 */

"use client";

import { useEffect, useCallback, useContext, createContext } from "react";
import { usePanelResizeMachine, useIsSuspended } from "../lib/panel-resize-context";

/**
 * Hook for tables that need to coordinate with panel resize.
 *
 * @param onLayoutStable - Callback to run when panel layout stabilizes
 * @returns Object with isSuspended flag
 *
 * @example
 * function MyTable() {
 *   const recalculate = useCallback(() => {
 *     // Recalculate column widths
 *   }, []);
 *
 *   const { isSuspended } = usePanelResizeCoordination(recalculate);
 *
 *   // Pass isSuspended to column sizing hook
 *   const { columnSizing } = useColumnSizing({
 *     suspendResize: isSuspended,
 *     // No resizeCompleteEvent needed - callback handles it
 *   });
 * }
 */
export function usePanelResizeCoordination(onLayoutStable?: () => void): {
  isSuspended: boolean;
} {
  const machine = usePanelResizeMachine();
  const isSuspended = useIsSuspended();

  // Register callback for layout stable notification
  useEffect(() => {
    if (!onLayoutStable) return;
    return machine.registerCallback("onLayoutStable", onLayoutStable);
  }, [machine, onLayoutStable]);

  return { isSuspended };
}

/**
 * Context for providing panel resize coordination to deeply nested components.
 * This allows DataTable to receive coordination without prop drilling.
 */
interface PanelResizeCoordinationContextValue {
  isSuspended: boolean;
  registerLayoutStableCallback: (callback: () => void) => () => void;
}

const PanelResizeCoordinationContext = createContext<PanelResizeCoordinationContextValue | null>(null);

/**
 * Hook to consume panel resize coordination from context.
 * Returns null if outside context (component handles independently).
 */
export function usePanelResizeCoordinationContext(): PanelResizeCoordinationContextValue | null {
  return useContext(PanelResizeCoordinationContext);
}

/**
 * Provider component for panel resize coordination.
 * Wraps components that need to coordinate with panel resize.
 */
export function PanelResizeCoordinationProvider({ children }: { children: React.ReactNode }) {
  const machine = usePanelResizeMachine();
  const isSuspended = useIsSuspended();

  const registerLayoutStableCallback = useCallback(
    (callback: () => void) => {
      return machine.registerCallback("onLayoutStable", callback);
    },
    [machine],
  );

  return (
    <PanelResizeCoordinationContext.Provider value={{ isSuspended, registerLayoutStableCallback }}>
      {children}
    </PanelResizeCoordinationContext.Provider>
  );
}
