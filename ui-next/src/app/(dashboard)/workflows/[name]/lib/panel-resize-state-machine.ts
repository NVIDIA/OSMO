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
 * STATE UNIFICATION (v2):
 * ========================
 * Previously, "panel at activity strip" was represented in TWO ways:
 * 1. isCollapsed: true (explicit collapse)
 * 2. widthPct < 20% (dragged to strip zone)
 *
 * This caused bugs because code had to check BOTH conditions.
 *
 * NOW: `isCollapsed` is DERIVED from `widthPct`, not stored separately.
 * - widthPct < STRIP_SNAP_THRESHOLD (20%) = collapsed
 * - Collapse action sets widthPct to strip target
 * - Expand action restores widthPct from persistedPct
 *
 * This ensures ONE canonical representation of "panel is collapsed".
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

import {
  calculateStripSnapTargetPct,
  SNAP_ZONES as SNAP_ZONE_CONSTANTS,
} from "@/app/(dashboard)/workflows/[name]/lib/panel-constants";

// =============================================================================
// Types
// =============================================================================

export type ResizePhase = "IDLE" | "DRAGGING" | "SNAPPING" | "SETTLING";
export type SnapZone = "strip" | "full";
export type CallbackType = "onLayoutStable" | "onPhaseChange";

// Re-export snap zone constants for backwards compatibility
export const SNAP_ZONES = SNAP_ZONE_CONSTANTS;

/**
 * Panel resize state.
 *
 * IMPORTANT: `isCollapsed` is no longer stored - it's DERIVED from widthPct.
 * Use `isCollapsed()` method or selector to check collapsed state.
 */
export interface ResizeState {
  phase: ResizePhase;
  /** Current display width percentage (2-100%). When < 20%, panel is collapsed. */
  widthPct: number;
  /**
   * "Remembered" width to restore on expand.
   * Always in the "free zone" range (20-80%) so it represents a usable panel width.
   * Updated when dragging in the free zone.
   */
  persistedPct: number;
  /** Current snap zone during drag (null when not in a snap zone) */
  snapZone: SnapZone | null;
  /** Target percentage for snap animation */
  snapTarget: number | null;
  /** Whether DAG should be visible (false when panel is full width) */
  dagVisible: boolean;
  /**
   * Width percentage captured BEFORE snap animation begins.
   * Used by ContentSlideWrapper to freeze content at pre-snap width.
   * Cleared when animation completes (phase returns to IDLE).
   */
  preSnapWidthPct: number | null;
  /**
   * Width percentage when drag started.
   * Used to determine persistedPct when drag ends in a snap zone.
   * This ensures snap zones are "magnetic destinations" - expansion restores
   * to where the user was working, not where they briefly passed through.
   * Cleared when transitioning to IDLE.
   */
  dragStartWidthPct: number | null;
}

export interface PanelResizeStateMachineOptions {
  initialPersistedPct: number;
  initialCollapsed: boolean;
  onPersist: (pct: number) => void;
  onPersistCollapsed: (collapsed: boolean) => void;
  minPct?: number;
  maxPct?: number;
  /** Width of the activity strip in pixels (for calculating strip snap target) */
  stripWidthPx?: number;
  /** Container width in pixels (for calculating strip snap target percentage) */
  containerWidthPx?: number;
}

// =============================================================================
// Constants and Helpers
// =============================================================================

const VALID_TRANSITIONS: Record<ResizePhase, ResizePhase[]> = {
  IDLE: ["DRAGGING", "SETTLING", "SNAPPING"],
  DRAGGING: ["SNAPPING", "SETTLING"],
  SNAPPING: ["SETTLING"],
  SETTLING: ["IDLE"],
};

const WIDTH_EPSILON = 0.01;

/** Default width when expanding and no valid persisted width exists */
const DEFAULT_EXPAND_WIDTH = 50;

export function classifySnapZone(widthPct: number): SnapZone | null {
  if (widthPct >= SNAP_ZONES.FULL_SNAP_START) return "full";
  if (widthPct < SNAP_ZONES.STRIP_SNAP_THRESHOLD) return "strip";
  return null;
}

function isAtTarget(current: number, target: number): boolean {
  return Math.abs(current - target) < WIDTH_EPSILON;
}

/**
 * Check if a width percentage represents "collapsed" state.
 * Collapsed = panel is at or near the activity strip width.
 */
export function isCollapsedWidth(widthPct: number): boolean {
  return widthPct < SNAP_ZONES.STRIP_SNAP_THRESHOLD;
}

/**
 * Ensure persistedPct is in a valid range for restoration.
 * Must be in the "free zone" (20-80%) to be useful.
 */
function normalizePersistedPct(pct: number): number {
  if (pct < SNAP_ZONES.STRIP_SNAP_THRESHOLD) {
    return DEFAULT_EXPAND_WIDTH;
  }
  if (pct >= SNAP_ZONES.FULL_SNAP_START) {
    return DEFAULT_EXPAND_WIDTH;
  }
  return pct;
}

function createInitialState(
  initialPersistedPct: number,
  initialCollapsed: boolean,
  stripSnapTargetPct: number,
): ResizeState {
  // Normalize persisted percentage to ensure it's in valid range
  const normalizedPersisted = normalizePersistedPct(initialPersistedPct);

  // If initially collapsed, set widthPct to strip target
  // Otherwise use the persisted percentage
  const widthPct = initialCollapsed ? stripSnapTargetPct : normalizedPersisted;

  return {
    phase: "IDLE",
    widthPct,
    persistedPct: normalizedPersisted,
    snapZone: null,
    snapTarget: null,
    dagVisible: widthPct < 100,
    preSnapWidthPct: null,
    dragStartWidthPct: null,
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
  private minPct: number;
  private readonly maxPct: number;
  private readonly onPersist: (pct: number) => void;
  private readonly onPersistCollapsed: (collapsed: boolean) => void;
  private stripSnapTargetPct: number;

  constructor(options: PanelResizeStateMachineOptions) {
    // Calculate strip snap target percentage based on strip width and container width
    // Default to 2% if not provided (approximately 40px on typical screens)
    // The CSS minWidthPx constraint will enforce the exact pixel minimum
    if (options.stripWidthPx && options.containerWidthPx && options.containerWidthPx > 0) {
      this.stripSnapTargetPct = calculateStripSnapTargetPct(options.containerWidthPx);
    } else {
      this.stripSnapTargetPct = 2;
    }

    this.state = createInitialState(options.initialPersistedPct, options.initialCollapsed, this.stripSnapTargetPct);

    this.minPct = options.minPct ?? this.stripSnapTargetPct;
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

  /**
   * Check if panel is currently collapsed.
   * This is the canonical way to check collapsed state - it's derived from widthPct.
   * During drag, we don't consider the panel collapsed even if width < threshold,
   * so collapse only takes effect when the user releases.
   */
  isCollapsed(): boolean {
    // Don't report as collapsed during active drag - only after release
    if (this.state.phase === "DRAGGING") {
      return false;
    }
    return isCollapsedWidth(this.state.widthPct);
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
      dragStartWidthPct: this.state.widthPct, // Capture starting position
      snapZone: null,
      snapTarget: null,
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

    // NOTE: persistedPct is NO LONGER updated during drag.
    // It will be determined at endDrag() based on final position:
    // - Free zone (20-80%): persist the final position
    // - Snap zone (< 20% or >= 80%): preserve dragStartWidthPct (where user was working)

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
   *
   * When snapping, preserves dragStartWidthPct (normalized) so expansion
   * returns to where the user was working, not the intermediate drag position.
   */
  private resolveSnapConfig(): { target: number; dagVisible: boolean; persistedPctOverride?: number } | null {
    const zone = this.state.snapZone;
    const isAtMaxTarget = this.state.widthPct >= SNAP_ZONES.FULL_SNAP_TARGET;

    // If snapping, preserve the width from where drag started (normalized)
    const preservedPct =
      this.state.dragStartWidthPct !== null ? normalizePersistedPct(this.state.dragStartWidthPct) : undefined;

    if (zone === "full" || isAtMaxTarget) {
      return {
        target: SNAP_ZONES.FULL_SNAP_TARGET,
        dagVisible: false,
        persistedPctOverride: preservedPct,
      };
    }
    if (zone === "strip") {
      return {
        target: this.stripSnapTargetPct,
        dagVisible: true,
        persistedPctOverride: preservedPct,
      };
    }
    return null;
  }

  /**
   * Settle immediately without snap animation.
   */
  private settleWithoutSnap(): void {
    const newPct = this.state.widthPct;
    const wasCollapsed = isCollapsedWidth(this.state.persistedPct);
    const isNowCollapsed = isCollapsedWidth(newPct);

    this.setState({
      phase: "SETTLING",
      persistedPct: normalizePersistedPct(newPct),
      snapZone: null,
      snapTarget: null,
    });

    this.onPersist(newPct);

    // Notify collapsed state change
    if (wasCollapsed !== isNowCollapsed) {
      this.onPersistCollapsed(isNowCollapsed);
    }

    this.scheduleLayoutStable();
  }

  /**
   * Already at target - skip SNAPPING phase and settle immediately.
   */
  private settleAtTarget(config: { target: number; dagVisible: boolean; persistedPctOverride?: number }): void {
    const isNowCollapsed = isCollapsedWidth(config.target);
    const wasCollapsed = this.isCollapsed();

    this.setState({
      phase: "SETTLING",
      widthPct: config.target,
      snapTarget: config.target,
      dagVisible: config.dagVisible,
      // Keep persistedPct unchanged for strip snap, update for free zone
      persistedPct: config.persistedPctOverride ?? this.state.persistedPct,
      snapZone: null,
    });

    this.onPersist(config.target);

    // Notify collapsed state change
    if (wasCollapsed !== isNowCollapsed) {
      this.onPersistCollapsed(isNowCollapsed);
    }

    this.scheduleLayoutStable();
  }

  /**
   * Animate to target via SNAPPING phase.
   */
  private animateToTarget(config: { target: number; dagVisible: boolean; persistedPctOverride?: number }): void {
    // Capture width BEFORE transition begins (for content freeze animation)
    const preSnapWidth = this.state.widthPct;

    const updates: Partial<ResizeState> = {
      phase: "SNAPPING",
      widthPct: config.target,
      snapTarget: config.target,
      dagVisible: config.dagVisible,
      preSnapWidthPct: preSnapWidth,
    };

    // If snapping, preserve the dragStartWidthPct (normalized)
    if (config.persistedPctOverride !== undefined) {
      updates.persistedPct = config.persistedPctOverride;
    }

    this.setState(updates);
  }

  /**
   * Handle CSS transition completion. Called by React's onTransitionEnd handler.
   */
  onTransitionComplete(): void {
    if (this.disposed) return;
    if (this.state.phase !== "SNAPPING") return;

    const targetPct = this.state.snapTarget ?? this.state.widthPct;
    const wasCollapsed = isCollapsedWidth(this.state.persistedPct);
    const isNowCollapsed = isCollapsedWidth(targetPct);

    this.setState({
      phase: "SETTLING",
      // Keep persistedPct unchanged - it was set correctly during drag or collapse
      snapZone: null,
      snapTarget: null,
    });

    this.onPersist(targetPct);

    // Notify collapsed state change
    if (wasCollapsed !== isNowCollapsed) {
      this.onPersistCollapsed(isNowCollapsed);
    }

    this.scheduleLayoutStable();
  }

  // ===========================================================================
  // Public API: Collapse Operations
  // ===========================================================================

  /**
   * Toggle between collapsed and expanded states.
   */
  toggleCollapsed(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    if (this.isCollapsed()) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  /**
   * Collapse the panel to the activity strip.
   */
  collapse(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;
    if (this.isCollapsed()) return; // Already collapsed

    // Capture width BEFORE transition begins (for content freeze animation)
    const preSnapWidth = this.state.widthPct;

    // Save current width before collapsing (if it's in the free zone)
    const currentPct = this.state.widthPct;
    const newPersisted =
      currentPct >= SNAP_ZONES.STRIP_SNAP_THRESHOLD && currentPct < SNAP_ZONES.FULL_SNAP_START
        ? currentPct
        : this.state.persistedPct;

    this.setState({
      phase: "SNAPPING",
      widthPct: this.stripSnapTargetPct,
      snapTarget: this.stripSnapTargetPct,
      persistedPct: normalizePersistedPct(newPersisted),
      dagVisible: true,
      preSnapWidthPct: preSnapWidth,
    });
  }

  /**
   * Set collapsed state explicitly.
   */
  setCollapsed(collapsed: boolean): void {
    if (this.disposed) return;
    if (this.isCollapsed() === collapsed) return;
    if (this.state.phase !== "IDLE") return;

    if (collapsed) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  /**
   * Expand the panel from collapsed state.
   */
  expand(): void {
    if (this.disposed) return;
    if (!this.isCollapsed()) return; // Not collapsed
    if (this.state.phase !== "IDLE") return;

    // Capture width BEFORE transition begins (for content freeze animation)
    const preSnapWidth = this.state.widthPct;

    // Restore to persisted width
    // If persisted width is invalid, default to 50%
    const targetPct = normalizePersistedPct(this.state.persistedPct);

    this.setState({
      phase: "SNAPPING",
      widthPct: targetPct,
      snapTarget: targetPct,
      persistedPct: targetPct,
      dagVisible: targetPct < 100,
      preSnapWidthPct: preSnapWidth,
    });
  }

  // ===========================================================================
  // Public API: Configuration Updates
  // ===========================================================================

  /**
   * Update the strip snap target percentage based on actual measurements.
   * Call this after the container is rendered and measured.
   *
   * Also updates minPct so that `clamp()` enforces the pixel-accurate minimum
   * during drag. Without this, the user can drag the panel narrower than the
   * activity strip because minPct was initialized with a stale default (2%).
   */
  updateStripSnapTarget(_stripWidthPx: number, containerWidthPx: number): void {
    if (this.disposed) return;
    if (containerWidthPx <= 0) return;

    const newTarget = calculateStripSnapTargetPct(containerWidthPx);
    if (Math.abs(this.stripSnapTargetPct - newTarget) > 0.01) {
      this.stripSnapTargetPct = newTarget;

      // Keep minPct in sync so clamp() enforces the pixel-accurate minimum
      // during drag. This prevents the panel from being dragged narrower than
      // ACTIVITY_STRIP_WIDTH_PX (the hard stop).
      this.minPct = newTarget;

      // If currently collapsed, update widthPct to match new target
      if (this.isCollapsed() && this.state.phase === "IDLE") {
        this.setState({ widthPct: newTarget });
      }
    }
  }

  // ===========================================================================
  // Public API: DAG Visibility
  // ===========================================================================

  hideDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    // Capture width BEFORE transition begins (for content freeze animation)
    const preSnapWidth = this.state.widthPct;

    this.setState({
      phase: "SNAPPING",
      widthPct: 100,
      snapTarget: 100,
      dagVisible: false,
      preSnapWidthPct: preSnapWidth,
    });
  }

  showDAG(): void {
    if (this.disposed) return;
    if (this.state.phase !== "IDLE") return;

    // Capture width BEFORE transition begins (for content freeze animation)
    const preSnapWidth = this.state.widthPct;
    const targetPct = normalizePersistedPct(this.state.persistedPct);

    this.setState({
      phase: "SNAPPING",
      widthPct: targetPct,
      snapTarget: targetPct,
      persistedPct: targetPct,
      dagVisible: true,
      preSnapWidthPct: preSnapWidth,
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
        this.setState({
          phase: "IDLE",
          preSnapWidthPct: null, // Clear pre-snap width when animation completes
          dragStartWidthPct: null, // Clear drag start width when returning to IDLE
        });
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
