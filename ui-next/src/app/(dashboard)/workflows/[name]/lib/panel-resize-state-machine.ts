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
 * Phase Diagram:
 *
 *   ┌──────┐  startDrag()  ┌────────┐  endDrag()  ┌────────┐  onTransitionComplete()  ┌─────────┐
 *   │ IDLE │──────────────▶│DRAGGING│────────────▶│SNAPPING│─────────────────────────▶│ SETTLING│
 *   └──────┘               └────────┘             └────────┘                          └─────────┘
 *       ▲                       │                                                          │
 *       │                       │ endDrag() (no snap or already at target)                 │
 *       │                       ▼                                                          │
 *       │                  ┌─────────┐                                                     │
 *       │                  │ SETTLING│                                                     │
 *       │                  └─────────┘                                                     │
 *       │                       │ double RAF                                               │
 *       └───────────────────────┴──────────────────────────────────────────────────────────┘
 */

// =============================================================================
// Types
// =============================================================================

export type ResizePhase = "IDLE" | "DRAGGING" | "SNAPPING" | "SETTLING";
export type SnapZone = "soft" | "full";
export type CallbackType = "onLayoutStable" | "onPhaseChange";

export const SNAP_ZONES = {
  SOFT_SNAP_START: 80,
  FULL_SNAP_START: 90,
  SOFT_SNAP_TARGET: 80,
  FULL_SNAP_TARGET: 100,
} as const;

export interface ResizeState {
  phase: ResizePhase;
  widthPct: number;
  persistedPct: number;
  snapZone: SnapZone | null;
  snapTarget: number | null;
  isCollapsed: boolean;
  dagVisible: boolean;
}

export interface PanelResizeStateMachineOptions {
  initialPersistedPct: number;
  initialCollapsed: boolean;
  onPersist: (pct: number) => void;
  onPersistCollapsed: (collapsed: boolean) => void;
  minPct?: number;
  maxPct?: number;
}

// =============================================================================
// Constants and Helpers
// =============================================================================

const VALID_TRANSITIONS: Record<ResizePhase, ResizePhase[]> = {
  IDLE: ["DRAGGING", "SETTLING"],
  DRAGGING: ["SNAPPING", "SETTLING"],
  SNAPPING: ["SETTLING"],
  SETTLING: ["IDLE"],
};

const WIDTH_EPSILON = 0.01;

export function classifySnapZone(widthPct: number): SnapZone | null {
  if (widthPct >= SNAP_ZONES.FULL_SNAP_START) return "full";
  if (widthPct >= SNAP_ZONES.SOFT_SNAP_START) return "soft";
  return null;
}

function isAtTarget(current: number, target: number): boolean {
  return Math.abs(current - target) < WIDTH_EPSILON;
}

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

  constructor(options: PanelResizeStateMachineOptions) {
    this.state = createInitialState(options.initialPersistedPct, options.initialCollapsed);

    this.minPct = options.minPct ?? 20;
    this.maxPct = options.maxPct ?? 100;
    this.onPersist = options.onPersist;
    this.onPersistCollapsed = options.onPersistCollapsed;
  }

  // ===========================================================================
  // Public API: State Access
  // ===========================================================================

  getState(): Readonly<ResizeState> {
    return this.state;
  }

  private canTransitionTo(targetPhase: ResizePhase): boolean {
    return VALID_TRANSITIONS[this.state.phase].includes(targetPhase);
  }

  // ===========================================================================
  // Public API: Drag Operations
  // ===========================================================================

  startDrag(): void {
    if (this.disposed) return;
    if (!this.canTransitionTo("DRAGGING")) return;

    this.setState({
      phase: "DRAGGING",
      snapZone: null,
      snapTarget: null,
      isCollapsed: false,
    });
  }

  updateDrag(pct: number): void {
    if (this.disposed) return;
    if (this.state.phase !== "DRAGGING") return;

    const clampedPct = this.clamp(pct);
    const newSnapZone = classifySnapZone(clampedPct);
    const hasChanged = clampedPct !== this.state.widthPct || newSnapZone !== this.state.snapZone;
    const isAtMax = clampedPct >= SNAP_ZONES.FULL_SNAP_TARGET;

    if (!hasChanged && !isAtMax) return;

    const updates: Partial<ResizeState> = {
      widthPct: clampedPct,
      snapZone: newSnapZone,
      dagVisible: clampedPct < 100,
    };

    // Only update persistedPct below soft snap zone - snap zones handle their own persistence
    if (clampedPct < SNAP_ZONES.SOFT_SNAP_START) {
      updates.persistedPct = clampedPct;
    }

    this.setState(updates);
  }

  /**
   * End drag operation. Transitions to SNAPPING if snap zone active and not
   * already at target, otherwise SETTLING.
   */
  endDrag(): void {
    if (this.disposed) return;
    if (this.state.phase !== "DRAGGING") return;

    const snapConfig = this.resolveSnapConfig();

    if (!snapConfig) {
      this.settleWithoutSnap();
      return;
    }

    if (isAtTarget(this.state.widthPct, snapConfig.target)) {
      this.settleAtTarget(snapConfig);
    } else {
      this.animateToTarget(snapConfig);
    }
  }

  /**
   * Determine snap configuration based on current state.
   * Returns null if no snap should occur.
   */
  private resolveSnapConfig(): { target: number; dagVisible: boolean; preservePersistedPct: boolean } | null {
    const zone = this.state.snapZone;
    const isAtMaxTarget = this.state.widthPct >= SNAP_ZONES.FULL_SNAP_TARGET;

    if (zone === "full" || isAtMaxTarget) {
      return { target: SNAP_ZONES.FULL_SNAP_TARGET, dagVisible: false, preservePersistedPct: true };
    }
    if (zone === "soft") {
      return { target: SNAP_ZONES.SOFT_SNAP_TARGET, dagVisible: true, preservePersistedPct: false };
    }
    return null;
  }

  /**
   * Settle immediately without snap animation.
   */
  private settleWithoutSnap(): void {
    this.setState({
      phase: "SETTLING",
      persistedPct: this.state.widthPct,
      snapZone: null,
      snapTarget: null,
    });
    this.onPersist(this.state.widthPct);
    this.scheduleLayoutStable();
  }

  /**
   * Already at target - skip SNAPPING phase and settle immediately.
   */
  private settleAtTarget(config: { target: number; dagVisible: boolean; preservePersistedPct: boolean }): void {
    this.setState({
      phase: "SETTLING",
      widthPct: config.target,
      snapTarget: config.target,
      dagVisible: config.dagVisible,
      persistedPct: config.preservePersistedPct ? this.state.persistedPct : config.target,
      snapZone: null,
    });
    this.onPersist(config.target);
    this.scheduleLayoutStable();
  }

  /**
   * Animate to target via SNAPPING phase.
   */
  private animateToTarget(config: { target: number; dagVisible: boolean }): void {
    this.setState({
      phase: "SNAPPING",
      widthPct: config.target,
      snapTarget: config.target,
      dagVisible: config.dagVisible,
    });
  }

  /**
   * Handle CSS transition completion. Called by React's onTransitionEnd handler.
   */
  onTransitionComplete(): void {
    if (this.disposed) return;
    if (this.state.phase !== "SNAPPING") return;

    const targetPct = this.state.snapTarget ?? this.state.widthPct;
    const preservePersistedPct = targetPct >= 100;

    this.setState({
      phase: "SETTLING",
      persistedPct: preservePersistedPct ? this.state.persistedPct : targetPct,
      snapZone: null,
      snapTarget: null,
    });

    this.onPersist(targetPct);
    this.scheduleLayoutStable();
  }

  // ===========================================================================
  // Public API: Collapse Operations
  // ===========================================================================

  toggleCollapsed(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    const newCollapsed = !this.state.isCollapsed;
    this.setState({ phase: "SETTLING", isCollapsed: newCollapsed });
    this.scheduleLayoutStable();
    this.onPersistCollapsed(newCollapsed);
  }

  setCollapsed(collapsed: boolean): void {
    if (this.disposed) return;
    if (this.state.isCollapsed === collapsed) return;
    if (this.state.phase !== "IDLE") return;

    this.setState({ phase: "SETTLING", isCollapsed: collapsed });
    this.scheduleLayoutStable();
    this.onPersistCollapsed(collapsed);
  }

  expand(): void {
    if (this.disposed) return;
    if (!this.state.isCollapsed) return;
    this.setCollapsed(false);
  }

  // ===========================================================================
  // Public API: DAG Visibility
  // ===========================================================================

  hideDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    this.setState({
      phase: "SNAPPING",
      widthPct: 100,
      snapTarget: 100,
      dagVisible: false,
    });
  }

  showDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    const targetPct = this.state.persistedPct < 100 ? this.state.persistedPct : 50;

    this.setState({
      phase: "SNAPPING",
      widthPct: targetPct,
      snapTarget: targetPct,
      persistedPct: targetPct,
      dagVisible: true,
    });
  }

  // ===========================================================================
  // Public API: Subscriptions
  // ===========================================================================

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  registerCallback(type: CallbackType, callback: () => void): () => void {
    if (this.disposed) return () => {};
    this.callbacks[type].add(callback);
    return () => this.callbacks[type].delete(callback);
  }

  // ===========================================================================
  // Public API: Lifecycle
  // ===========================================================================

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const id of this.pendingRafIds) {
      cancelAnimationFrame(id);
    }
    this.pendingRafIds = [];

    this.subscribers.clear();
    this.callbacks.onLayoutStable.clear();
    this.callbacks.onPhaseChange.clear();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private setState(update: Partial<ResizeState>): void {
    if (this.disposed) return;

    const hasChanges = Object.keys(update).some(
      (key) => this.state[key as keyof ResizeState] !== update[key as keyof ResizeState],
    );
    if (!hasChanges) return;

    const oldPhase = this.state.phase;
    this.state = { ...this.state, ...update };
    this.notifySubscribers();

    if (update.phase && update.phase !== oldPhase) {
      this.notifyCallbacks("onPhaseChange");
    }
  }

  private notifySubscribers(): void {
    if (this.disposed) return;
    this.subscribers.forEach((listener) => listener());
  }

  private notifyCallbacks(type: CallbackType): void {
    if (this.disposed) return;
    this.callbacks[type].forEach((cb) => cb());
  }

  /**
   * Double RAF ensures layout has fully computed before transitioning to IDLE.
   */
  private scheduleLayoutStable(): void {
    if (this.disposed) return;

    const id1 = requestAnimationFrame(() => {
      if (this.disposed) return;
      this.removeRafId(id1);

      const id2 = requestAnimationFrame(() => {
        if (this.disposed) return;
        this.removeRafId(id2);
        this.setState({ phase: "IDLE" });
        this.notifyCallbacks("onLayoutStable");
      });

      this.pendingRafIds.push(id2);
    });

    this.pendingRafIds.push(id1);
  }

  private removeRafId(id: number): void {
    const idx = this.pendingRafIds.indexOf(id);
    if (idx !== -1) this.pendingRafIds.splice(idx, 1);
  }

  private clamp(pct: number): number {
    return Math.min(this.maxPct, Math.max(this.minPct, pct));
  }
}
