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
 * Panel interaction state machine types (simplified post-622-line-reduction).
 *
 * Focus: Snap zone detection and transitions only.
 * Drag state remains local to visualization components (not orchestrated here).
 */

/**
 * Panel interaction phases.
 *
 * State transitions:
 * - idle → dragging (on drag start)
 * - dragging → snapping (when released in snap zone)
 * - dragging → idle (when released outside snap zone)
 * - snapping → idle (after snap animation completes)
 */
export type PanelPhase =
  | { type: "idle" }
  | { type: "dragging"; startPct: number; currentPct: number; snapZone: SnapZone | null }
  | { type: "snapping"; targetPct: number; snapZone: SnapZone };

/**
 * Snap zones for panel width.
 * - soft: 80% width threshold - visual indicator, no auto-action
 * - full: 90% width threshold - triggers collapse + DAG hide on release
 */
export type SnapZone = "soft" | "full";

export const SNAP_ZONES = {
  SOFT_SNAP_START: 80,
  FULL_SNAP_START: 90,
  SOFT_SNAP_TARGET: 80,
  FULL_SNAP_TARGET: 100,
} as const;

export function classifySnapZone(widthPct: number): SnapZone | null {
  if (widthPct >= SNAP_ZONES.FULL_SNAP_START) return "full";
  if (widthPct >= SNAP_ZONES.SOFT_SNAP_START) return "soft";
  return null;
}
