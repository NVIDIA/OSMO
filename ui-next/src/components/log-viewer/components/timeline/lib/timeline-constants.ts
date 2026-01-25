//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Timeline Constants
 *
 * Centralized constants for the timeline module.
 * Single source of truth for all magic numbers and configuration values.
 */

// =============================================================================
// Display Configuration
// =============================================================================

/** Default height of the histogram in pixels */
export const DEFAULT_HEIGHT = 80;

/** Padding ratio for display range (7.5% on each side) */
export const DISPLAY_PADDING_RATIO = 0.075;

/** Minimum padding in milliseconds (30 seconds) */
export const MIN_PADDING_MS = 30_000;

/** Default fallback duration when no data (1 hour in milliseconds) */
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// =============================================================================
// Time Thresholds
// =============================================================================

/** Threshold for considering end time as "now" (1 minute) */
export const NOW_THRESHOLD_MS = 60_000;

/** Minimum range in milliseconds (1 minute) */
export const MIN_RANGE_MS = 60_000;

// =============================================================================
// Gesture Configuration
// =============================================================================

/** Pan amount as fraction of visible range (10% per wheel tick) */
export const PAN_FACTOR = 0.1;

/** Zoom in factor (narrow by 20%) */
export const ZOOM_IN_FACTOR = 0.8;

/** Zoom out factor (widen by 25%) */
export const ZOOM_OUT_FACTOR = 1.25;

/** Keyboard nudge amount in milliseconds (5 minutes) */
export const KEYBOARD_NUDGE_MS = 5 * 60 * 1000;

// =============================================================================
// Time Range Presets
// =============================================================================

export type TimeRangePreset = "all" | "5m" | "15m" | "1h" | "6h" | "24h" | "custom";

export const PRESET_LABELS: Record<TimeRangePreset, string> = {
  all: "All",
  "5m": "Last 5m",
  "15m": "Last 15m",
  "1h": "Last 1h",
  "6h": "Last 6h",
  "24h": "Last 24h",
  custom: "Custom",
};

export const PRESET_ORDER: TimeRangePreset[] = ["all", "5m", "15m", "1h", "6h", "24h"];
