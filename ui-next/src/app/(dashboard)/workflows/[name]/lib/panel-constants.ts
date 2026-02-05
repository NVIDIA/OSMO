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
 * Panel Layout Constants and Pure Calculation Functions
 *
 * Single source of truth for all workflow panel dimensions, ratios, and calculations.
 * This ensures consistency across panel resize, snap zones, and layout calculations.
 */

// =============================================================================
// Dimension Constants (pixels)
// =============================================================================

/** Width of the activity strip that remains visible when panel is minimized */
export const ACTIVITY_STRIP_WIDTH_PX = 40;

// =============================================================================
// Snap Zone Thresholds (percentages)
// =============================================================================

export const SNAP_ZONES = {
  /** Panel width below this % triggers "strip" snap (collapse to activity strip) */
  STRIP_SNAP_THRESHOLD: 20,
  /** Panel width above this % triggers "full" snap (expand to 100%) */
  FULL_SNAP_START: 80,
  /** Strip snap target (calculated dynamically) */
  STRIP_SNAP_TARGET: 0,
  /** Full snap target (hide DAG completely) */
  FULL_SNAP_TARGET: 100,
} as const;

// =============================================================================
// Panel Width Constraints (percentages)
// =============================================================================

export const PANEL_CONSTRAINTS = {
  /** Minimum percentage (effectively disabled for workflow, use minWidthPx instead) */
  MIN_PCT: 0,
  /** Maximum percentage (full width, hides DAG) */
  MAX_PCT: 100,
} as const;

// =============================================================================
// Animation Timing
// =============================================================================

export const PANEL_TIMING = {
  /** Duration for DAG enter/exit transitions (ms) */
  DAG_TRANSITION_MS: 250,
  /** CSS transition timing for grid columns */
  TRANSITION_TIMING: "200ms ease-out",
} as const;

// =============================================================================
// Pure Calculation Functions
// =============================================================================

/**
 * Convert pixels to percentage of container width.
 * @param pixels - Width in pixels
 * @param containerWidth - Container width in pixels
 * @returns Percentage (0-100), or 0 if container is invalid
 */
export function pxToPercent(pixels: number, containerWidth: number): number {
  if (containerWidth <= 0) return 0;
  return (pixels / containerWidth) * 100;
}

/**
 * Convert percentage to pixels.
 * @param percent - Percentage (0-100)
 * @param containerWidth - Container width in pixels
 * @returns Width in pixels
 */
export function percentToPx(percent: number, containerWidth: number): number {
  return containerWidth * (percent / 100);
}

/**
 * Calculate the strip snap target percentage based on container width.
 * Ensures at least 1% to prevent division issues.
 * @param containerWidth - Container width in pixels
 * @returns Strip snap target percentage
 */
export function calculateStripSnapTargetPct(containerWidth: number): number {
  if (containerWidth <= 0) return 2; // Safe fallback
  return Math.max(1, pxToPercent(ACTIVITY_STRIP_WIDTH_PX, containerWidth));
}

/**
 * Compute panel positioning for right-aligned panel layout.
 * @param panelPct - Panel width as percentage
 * @param containerWidth - Container width in pixels
 * @returns Panel dimensions and position
 */
export function computePanelGeometry(
  panelPct: number,
  containerWidth: number,
): {
  panelWidthPx: number;
  panelLeftPx: number;
  dagWidthPx: number;
} {
  const panelWidthPx = percentToPx(panelPct, containerWidth);
  const panelLeftPx = containerWidth - panelWidthPx;
  const dagWidthPx = panelLeftPx;
  return { panelWidthPx, panelLeftPx, dagWidthPx };
}

/**
 * Compute overlay geometry for snap zone indicators.
 * @param panelPct - Current panel width percentage
 * @param containerWidth - Container width in pixels
 * @returns Overlay dimensions relative to container, or null if overlay would be invisible
 */
export function computeSnapIndicatorGeometry(
  panelPct: number,
  containerWidth: number,
): {
  overlayLeftPx: number;
  overlayWidthPx: number;
} | null {
  const { panelWidthPx, panelLeftPx } = computePanelGeometry(panelPct, containerWidth);
  const overlayLeftPx = panelLeftPx + ACTIVITY_STRIP_WIDTH_PX;
  const overlayWidthPx = panelWidthPx - ACTIVITY_STRIP_WIDTH_PX;

  if (overlayWidthPx <= 0) return null;

  return { overlayLeftPx, overlayWidthPx };
}

/**
 * Classify which snap zone the current width is in.
 * @param widthPct - Current panel width percentage
 * @returns 'strip' | 'full' | null
 */
export function classifySnapZone(widthPct: number): "strip" | "full" | null {
  if (widthPct >= SNAP_ZONES.FULL_SNAP_START) return "full";
  if (widthPct < SNAP_ZONES.STRIP_SNAP_THRESHOLD) return "strip";
  return null;
}
