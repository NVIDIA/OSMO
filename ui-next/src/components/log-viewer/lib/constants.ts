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
 * Log Viewer Constants
 *
 * Centralized constants for the log viewer component.
 * Single source of truth for dimensions, thresholds, and magic numbers.
 */

// =============================================================================
// Virtualization
// =============================================================================

/** Estimated row height for virtualization (pixels) */
export const ROW_HEIGHT_ESTIMATE = 32;

/** Estimated expanded row height (approximately 4x collapsed) */
export const EXPANDED_ROW_HEIGHT_ESTIMATE = ROW_HEIGHT_ESTIMATE * 4;

/** Overscan count for smooth scrolling */
export const OVERSCAN_COUNT = 10;

// =============================================================================
// Scroll Behavior
// =============================================================================

/** Threshold for detecting scroll to bottom (pixels from bottom) */
export const SCROLL_BOTTOM_THRESHOLD = 50;

// =============================================================================
// Histogram
// =============================================================================

/** Default histogram height (pixels) */
export const HISTOGRAM_HEIGHT = 80;

/** Gap between histogram bars (pixels) */
export const HISTOGRAM_BAR_GAP = 1;

/** Minimum histogram bar width (pixels) */
export const HISTOGRAM_MIN_BAR_WIDTH = 4;

// =============================================================================
// Skeleton
// =============================================================================

/**
 * Pre-computed widths for skeleton rows.
 * Avoids Math.random() during render for deterministic output.
 */
export const SKELETON_WIDTHS = ["85%", "72%", "90%", "65%", "78%", "82%", "70%", "88%"] as const;
