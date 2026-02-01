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
 * PanelResizeStateMachine - Deterministic state machine for panel resize operations.
 *
 * Architecture Principles:
 * 1. Single Source of Truth - All resize state lives here
 * 2. Explicit Phases - No implicit boolean combinations
 * 3. Guarded Transitions - Invalid state changes are no-ops
 * 4. React-Controlled DOM - No direct DOM manipulation (React reads state, applies to DOM)
 * 5. Callback Coordination - Direct function calls, not events
 *
 * Phase Diagram:
 *
 *              startDrag()
 *           ┌──────────────┐
 *           │              │
 *           ▼              │
 *   ┌──────┐     ┌────────┐     ┌────────┐     ┌─────────┐
 *   │ IDLE │────▶│DRAGGING│────▶│SNAPPING│────▶│ SETTLING│
 *   └──────┘     └────────┘     └────────┘     └─────────┘
 *       ▲             │              │               │
 *       │             │ endDrag()    │ onTransition  │
 *       │             │ (no snap)    │ Complete()    │
 *       │             ▼              ▼               │
 *       │        ┌─────────────────────┐             │
 *       │        │      SETTLING       │             │
 *       │        └─────────────────────┘             │
 *       │                   │                        │
 *       │          double RAF → layoutStable()       │
 *       └────────────────────────────────────────────┘
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Explicit phases for panel resize operations.
 * Each phase has clear semantics and valid transitions.
 */
export type ResizePhase = "IDLE" | "DRAGGING" | "SNAPPING" | "SETTLING";

/**
 * Snap zones for panel width thresholds.
 */
export type SnapZone = "soft" | "full";

/**
 * Snap zone thresholds and targets (percentages).
 */
export const SNAP_ZONES = {
  SOFT_SNAP_START: 80,
  FULL_SNAP_START: 90,
  SOFT_SNAP_TARGET: 80,
  FULL_SNAP_TARGET: 100,
} as const;

/**
 * Complete state managed by the state machine.
 */
export interface ResizeState {
  /** Current phase of resize operation */
  phase: ResizePhase;
  /** Current display width as percentage (0-100) */
  widthPct: number;
  /** Persisted width percentage (synced to storage) */
  persistedPct: number;
  /** Current snap zone during drag (null if outside zones) */
  snapZone: SnapZone | null;
  /** Target width for SNAPPING phase (null otherwise) */
  snapTarget: number | null;
  /** Whether panel is collapsed */
  isCollapsed: boolean;
  /** Whether DAG is visible (derived from widthPct < 100) */
  dagVisible: boolean;
}

/**
 * Callback types for coordination with other systems.
 */
export type CallbackType = "onLayoutStable" | "onPhaseChange";

/**
 * Options for state machine constructor.
 */
export interface PanelResizeStateMachineOptions {
  /** Initial persisted panel width percentage */
  initialPersistedPct: number;
  /** Initial collapsed state from storage */
  initialCollapsed: boolean;
  /** Callback to persist width to storage */
  onPersist: (pct: number) => void;
  /** Callback to persist collapsed state to storage */
  onPersistCollapsed: (collapsed: boolean) => void;
  /** Callback when DAG should be hidden (full snap) */
  onHideDAG: () => void;
  /** Minimum width percentage */
  minPct?: number;
  /** Maximum width percentage */
  maxPct?: number;
}

// =============================================================================
// Valid Transitions
// =============================================================================

/**
 * Map of valid phase transitions.
 * Used for transition guards.
 */
const VALID_TRANSITIONS: Record<ResizePhase, ResizePhase[]> = {
  IDLE: ["DRAGGING", "SETTLING"], // SETTLING for collapse toggle
  DRAGGING: ["SNAPPING", "SETTLING"],
  SNAPPING: ["SETTLING"],
  SETTLING: ["IDLE"],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Classify width percentage into snap zone.
 */
export function classifySnapZone(widthPct: number): SnapZone | null {
  if (widthPct >= SNAP_ZONES.FULL_SNAP_START) return "full";
  if (widthPct >= SNAP_ZONES.SOFT_SNAP_START) return "soft";
  return null;
}

/**
 * Default state (SSR-safe).
 */
function createInitialState(initialPersistedPct: number, initialCollapsed: boolean): ResizeState {
  return {
    phase: "IDLE",
    widthPct: initialPersistedPct,
    persistedPct: initialPersistedPct,
    snapZone: null,
    snapTarget: null,
    isCollapsed: initialCollapsed,
    dagVisible: initialPersistedPct < 100,
  };
}

// =============================================================================
// State Machine Class
// =============================================================================

export class PanelResizeStateMachine {
  private state: ResizeState;
  private subscribers = new Set<() => void>();
  private callbacks: Record<CallbackType, Set<() => void>> = {
    onLayoutStable: new Set(),
    onPhaseChange: new Set(),
  };
  private disposed = false;

  // Pending RAF IDs for cleanup
  private pendingRafIds: number[] = [];

  // Options
  private readonly minPct: number;
  private readonly maxPct: number;
  private readonly onPersist: (pct: number) => void;
  private readonly onPersistCollapsed: (collapsed: boolean) => void;
  private readonly onHideDAG: () => void;

  constructor(options: PanelResizeStateMachineOptions) {
    this.state = createInitialState(options.initialPersistedPct, options.initialCollapsed);

    this.minPct = options.minPct ?? 20;
    this.maxPct = options.maxPct ?? 100;
    this.onPersist = options.onPersist;
    this.onPersistCollapsed = options.onPersistCollapsed;
    this.onHideDAG = options.onHideDAG;
  }

  // ===========================================================================
  // Public API: State Access
  // ===========================================================================

  /**
   * Get full state snapshot (for React hooks).
   */
  getState(): Readonly<ResizeState> {
    return this.state;
  }

  /**
   * Check if a specific transition is valid from current state.
   */
  private canTransitionTo(targetPhase: ResizePhase): boolean {
    return VALID_TRANSITIONS[this.state.phase].includes(targetPhase);
  }

  // ===========================================================================
  // Public API: Drag Operations
  // ===========================================================================

  /**
   * Start drag operation.
   * Guard: Only valid from IDLE phase.
   */
  startDrag(): void {
    if (this.disposed) return;
    if (!this.canTransitionTo("DRAGGING")) return;

    const startPct = this.state.persistedPct;

    this.setState({
      phase: "DRAGGING",
      widthPct: startPct,
      snapZone: null,
      snapTarget: null,
      // If currently collapsed, expand on drag start
      isCollapsed: false,
    });
  }

  /**
   * Update during drag.
   * Guard: Only valid during DRAGGING phase.
   */
  updateDrag(pct: number): void {
    if (this.disposed) return;
    if (this.state.phase !== "DRAGGING") return;

    const clampedPct = this.clamp(pct);
    const newSnapZone = classifySnapZone(clampedPct);

    // Only update and notify if something actually changed
    if (clampedPct === this.state.widthPct && newSnapZone === this.state.snapZone) {
      return;
    }

    this.setState({
      widthPct: clampedPct,
      snapZone: newSnapZone,
      dagVisible: clampedPct < 100,
    });
  }

  /**
   * End drag operation.
   * Guard: Only valid from DRAGGING phase.
   * Transitions to SNAPPING if snap zone active, otherwise SETTLING.
   */
  endDrag(): void {
    if (this.disposed) return;
    if (this.state.phase !== "DRAGGING") return;

    const zone = this.state.snapZone;

    if (zone === "full") {
      // Full-width snap: Transition to SNAPPING
      this.setState({
        phase: "SNAPPING",
        widthPct: SNAP_ZONES.FULL_SNAP_TARGET,
        snapTarget: SNAP_ZONES.FULL_SNAP_TARGET,
        dagVisible: false,
      });
    } else if (zone === "soft") {
      // Soft snap to 80%
      this.setState({
        phase: "SNAPPING",
        widthPct: SNAP_ZONES.SOFT_SNAP_TARGET,
        snapTarget: SNAP_ZONES.SOFT_SNAP_TARGET,
        dagVisible: true,
      });
    } else {
      // No snap: Go directly to SETTLING
      this.setState({
        phase: "SETTLING",
        persistedPct: this.state.widthPct,
        snapZone: null,
        snapTarget: null,
      });

      // Persist immediately for non-snap case
      this.onPersist(this.state.widthPct);

      // Schedule layout stable notification
      this.scheduleLayoutStable();
    }
  }

  /**
   * Handle CSS transition completion.
   * Guard: Only valid from SNAPPING phase.
   * Called by React's onTransitionEnd handler.
   */
  onTransitionComplete(): void {
    if (this.disposed) return;
    if (this.state.phase !== "SNAPPING") return;

    const targetPct = this.state.snapTarget ?? this.state.widthPct;

    this.setState({
      phase: "SETTLING",
      persistedPct: targetPct,
      snapZone: null,
      snapTarget: null,
    });

    // Persist and trigger callbacks
    this.onPersist(targetPct);
    if (targetPct >= 100) {
      this.onHideDAG();
    }

    // Schedule layout stable notification
    this.scheduleLayoutStable();
  }

  // ===========================================================================
  // Public API: Collapse Operations
  // ===========================================================================

  /**
   * Toggle collapsed state.
   * Uses SETTLING phase to wait for collapse transition.
   */
  toggleCollapsed(): void {
    if (this.disposed) return;
    // Allow from IDLE only
    if (this.state.phase !== "IDLE") return;

    const newCollapsed = !this.state.isCollapsed;

    this.setState({
      phase: "SETTLING",
      isCollapsed: newCollapsed,
    });

    // Schedule layout stable notification (collapse has CSS transition)
    this.scheduleLayoutStable();

    // Persist collapsed state
    this.onPersistCollapsed(newCollapsed);
  }

  /**
   * Set collapsed state explicitly.
   */
  setCollapsed(collapsed: boolean): void {
    if (this.disposed) return;
    if (this.state.isCollapsed === collapsed) return;
    // Allow from IDLE only
    if (this.state.phase !== "IDLE") return;

    this.setState({
      phase: "SETTLING",
      isCollapsed: collapsed,
    });

    this.scheduleLayoutStable();
    this.onPersistCollapsed(collapsed);
  }

  /**
   * Expand panel (for drag-to-expand from collapsed state).
   */
  expand(): void {
    if (this.disposed) return;
    if (!this.state.isCollapsed) return;
    this.setCollapsed(false);
  }

  // ===========================================================================
  // Public API: DAG Visibility
  // ===========================================================================

  /**
   * Hide DAG (set width to 100%).
   */
  hideDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    this.setState({
      phase: "SETTLING",
      widthPct: 100,
      persistedPct: 100,
      dagVisible: false,
    });

    this.scheduleLayoutStable();
  }

  /**
   * Show DAG (restore to previous width or default 50%).
   */
  showDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    const targetPct = this.state.persistedPct < 100 ? this.state.persistedPct : 50;

    this.setState({
      phase: "SETTLING",
      widthPct: targetPct,
      persistedPct: targetPct,
      dagVisible: true,
    });

    this.scheduleLayoutStable();
  }

  // ===========================================================================
  // Public API: Subscriptions
  // ===========================================================================

  /**
   * Subscribe to state changes (for React re-renders via useSyncExternalStore).
   */
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};

    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };

  /**
   * Register a callback for specific events.
   * Returns unsubscribe function.
   */
  registerCallback(type: CallbackType, callback: () => void): () => void {
    if (this.disposed) return () => {};

    this.callbacks[type].add(callback);
    return () => {
      this.callbacks[type].delete(callback);
    };
  }

  // ===========================================================================
  // Public API: Lifecycle
  // ===========================================================================

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Cancel pending RAFs
    for (const id of this.pendingRafIds) {
      cancelAnimationFrame(id);
    }
    this.pendingRafIds = [];

    // Clear subscribers and callbacks
    this.subscribers.clear();
    this.callbacks.onLayoutStable.clear();
    this.callbacks.onPhaseChange.clear();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Update state and notify subscribers.
   */
  private setState(update: Partial<ResizeState>): void {
    if (this.disposed) return;

    // Check for actual changes
    const hasChanges = Object.keys(update).some(
      (key) => this.state[key as keyof ResizeState] !== update[key as keyof ResizeState],
    );

    if (!hasChanges) return;

    const oldPhase = this.state.phase;

    // Update state
    this.state = { ...this.state, ...update };

    // Notify state subscribers (triggers React re-renders)
    this.notify();

    // Notify phase change callbacks if phase changed
    if (update.phase && update.phase !== oldPhase) {
      this.notifyPhaseChange();
    }
  }

  /**
   * Notify all state subscribers.
   */
  private notify(): void {
    if (this.disposed) return;
    this.subscribers.forEach((listener) => listener());
  }

  /**
   * Notify phase change callbacks.
   */
  private notifyPhaseChange(): void {
    if (this.disposed) return;
    this.callbacks.onPhaseChange.forEach((cb) => cb());
  }

  /**
   * Notify layout stable callbacks.
   */
  private notifyLayoutStable(): void {
    if (this.disposed) return;
    this.callbacks.onLayoutStable.forEach((cb) => cb());
  }

  /**
   * Schedule layout stable notification using double RAF.
   * Double RAF ensures layout has fully computed:
   * - First RAF: After current paint
   * - Second RAF: After layout reflow completes
   */
  private scheduleLayoutStable(): void {
    if (this.disposed) return;

    const id1 = requestAnimationFrame(() => {
      if (this.disposed) return;
      this.removeRafId(id1);

      const id2 = requestAnimationFrame(() => {
        if (this.disposed) return;
        this.removeRafId(id2);

        // Transition to IDLE and notify callbacks
        this.setState({ phase: "IDLE" });
        this.notifyLayoutStable();
      });

      this.pendingRafIds.push(id2);
    });

    this.pendingRafIds.push(id1);
  }

  /**
   * Remove RAF ID from pending list.
   */
  private removeRafId(id: number): void {
    const idx = this.pendingRafIds.indexOf(id);
    if (idx !== -1) this.pendingRafIds.splice(idx, 1);
  }

  /**
   * Clamp width percentage to valid range.
   */
  private clamp(pct: number): number {
    return Math.min(this.maxPct, Math.max(this.minPct, pct));
  }
}
