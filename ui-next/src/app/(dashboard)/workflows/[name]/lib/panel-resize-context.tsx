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
 * React Context and Hooks for PanelResizeStateMachine.
 *
 * Provides:
 * - PanelResizeProvider: Context provider that manages machine lifecycle
 * - usePanelResizeMachine: Access to raw machine instance
 * - usePanelResize: Reactive state + actions hook
 */

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  PanelResizeStateMachine,
  type PanelResizeStateMachineOptions,
  type ResizePhase,
  type ResizeState,
  type SnapZone,
} from "./panel-resize-state-machine";

// =============================================================================
// Context
// =============================================================================

interface PanelResizeContextValue {
  machine: PanelResizeStateMachine;
}

const PanelResizeContext = createContext<PanelResizeContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface PanelResizeProviderProps extends Omit<PanelResizeStateMachineOptions, "minPct" | "maxPct"> {
  children: ReactNode;
  minPct?: number;
  maxPct?: number;
}

/**
 * Provider for PanelResizeStateMachine.
 * Creates machine instance once and manages its lifecycle.
 */
export function PanelResizeProvider({ children, ...options }: PanelResizeProviderProps) {
  // Create machine instance once using useMemo singleton pattern
  // This survives Strict Mode remounts because useMemo with empty deps only runs once
  const machine = useMemo(() => {
    return new PanelResizeStateMachine(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps = create only once, never recreate

  // Track if component is mounted
  const isMountedRef = useRef(true);

  // Cleanup on unmount - but handle Strict Mode gracefully
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Delay disposal to avoid disposing during Strict Mode remount
      // If component remounts quickly (Strict Mode), this disposal is skipped
      setTimeout(() => {
        if (!isMountedRef.current) {
          machine.dispose();
        }
      }, 0);
    };
  }, [machine]);

  // Memoize context value
  const contextValue = useMemo(() => ({ machine }), [machine]);

  return <PanelResizeContext.Provider value={contextValue}>{children}</PanelResizeContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the raw PanelResizeStateMachine instance.
 * Use this for advanced scenarios or direct machine access.
 */
export function usePanelResizeMachine(): PanelResizeStateMachine {
  const context = useContext(PanelResizeContext);

  if (!context) {
    throw new Error("usePanelResizeMachine must be used within PanelResizeProvider");
  }

  return context.machine;
}

/**
 * Main hook for panel resize state and actions.
 * Returns reactive state that triggers re-renders on changes.
 */
export function usePanelResize(): {
  // State
  phase: ResizePhase;
  widthPct: number;
  persistedPct: number;
  dagVisible: boolean;
  isCollapsed: boolean;
  snapZone: SnapZone | null;
  snapTarget: number | null;

  // Derived
  isSuspended: boolean;
  isDragging: boolean;
  isTransitioning: boolean;
  transitionEnabled: boolean;

  // Actions
  startDrag: () => void;
  updateDrag: (pct: number) => void;
  endDrag: () => void;
  onTransitionComplete: () => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  expand: () => void;
  hideDAG: () => void;
  showDAG: () => void;
  updateStripSnapTarget: (stripWidthPx: number, containerWidthPx: number) => void;
} {
  const machine = usePanelResizeMachine();

  // Subscribe to state changes using useSyncExternalStore
  const state = useSyncExternalStore(
    machine.subscribe,
    () => machine.getState(),
    () => machine.getState(), // Server snapshot
  );

  // Derive computed values
  const isSuspended = state.phase !== "IDLE";
  const isDragging = state.phase === "DRAGGING";
  const isTransitioning = state.phase === "SNAPPING" || state.phase === "SETTLING";
  const transitionEnabled = state.phase !== "DRAGGING";

  // Memoize actions to prevent unnecessary re-renders
  const startDrag = useCallback(() => machine.startDrag(), [machine]);
  const updateDrag = useCallback((pct: number) => machine.updateDrag(pct), [machine]);
  const endDrag = useCallback(() => machine.endDrag(), [machine]);
  const onTransitionComplete = useCallback(() => machine.onTransitionComplete(), [machine]);
  const toggleCollapsed = useCallback(() => machine.toggleCollapsed(), [machine]);
  const setCollapsed = useCallback((collapsed: boolean) => machine.setCollapsed(collapsed), [machine]);
  const expand = useCallback(() => machine.expand(), [machine]);
  const hideDAG = useCallback(() => machine.hideDAG(), [machine]);
  const showDAG = useCallback(() => machine.showDAG(), [machine]);
  const updateStripSnapTarget = useCallback(
    (stripWidthPx: number, containerWidthPx: number) => machine.updateStripSnapTarget(stripWidthPx, containerWidthPx),
    [machine],
  );

  return {
    // State
    phase: state.phase,
    widthPct: state.widthPct,
    persistedPct: state.persistedPct,
    dagVisible: state.dagVisible,
    isCollapsed: state.isCollapsed,
    snapZone: state.snapZone,
    snapTarget: state.snapTarget,

    // Derived
    isSuspended,
    isDragging,
    isTransitioning,
    transitionEnabled,

    // Actions
    startDrag,
    updateDrag,
    endDrag,
    onTransitionComplete,
    toggleCollapsed,
    setCollapsed,
    expand,
    hideDAG,
    showDAG,
    updateStripSnapTarget,
  };
}

// =============================================================================
// Selector Hooks (Optimized for specific subscriptions)
// =============================================================================

/**
 * Select specific state value.
 * Re-renders only when selected value changes (per useSyncExternalStore semantics).
 */
function usePanelResizeSelector<T>(selector: (state: ResizeState) => T): T {
  const machine = usePanelResizeMachine();

  return useSyncExternalStore(
    machine.subscribe,
    () => selector(machine.getState()),
    () => selector(machine.getState()),
  );
}

/**
 * Get current width percentage.
 */
export function usePanelWidth(): number {
  return usePanelResizeSelector((s) => s.widthPct);
}

/**
 * Get persisted width percentage.
 */
export function usePersistedPanelWidth(): number {
  return usePanelResizeSelector((s) => s.persistedPct);
}

/**
 * Get whether panel is collapsed.
 */
export function useIsPanelCollapsed(): boolean {
  return usePanelResizeSelector((s) => s.isCollapsed);
}

/**
 * Get DAG visibility for display purposes.
 * Considers phase state for smooth transitions.
 */
export function useDisplayDagVisible(): boolean {
  return usePanelResizeSelector((s) => {
    // During drag: reveal DAG as panel shrinks below 100%
    if (s.phase === "DRAGGING") {
      return s.widthPct < 100;
    }
    // During transitions: keep DAG visible for smooth animation
    if (s.phase === "SNAPPING" || s.phase === "SETTLING") {
      return true;
    }
    // Otherwise: use persisted visibility state
    return s.dagVisible;
  });
}

/**
 * Get current snap zone.
 */
export function useSnapZone(): SnapZone | null {
  return usePanelResizeSelector((s) => s.snapZone);
}

/**
 * Check if any operation is in progress (not IDLE).
 */
export function useIsSuspended(): boolean {
  return usePanelResizeSelector((s) => s.phase !== "IDLE");
}

/**
 * Check if currently dragging.
 */
export function useIsDragging(): boolean {
  return usePanelResizeSelector((s) => s.phase === "DRAGGING");
}

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type { ResizePhase, ResizeState, SnapZone };
export { SNAP_ZONES, classifySnapZone } from "./panel-resize-state-machine";
