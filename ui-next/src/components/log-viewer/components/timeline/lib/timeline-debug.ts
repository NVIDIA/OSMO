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
 * Timeline Debug Module
 *
 * Isolated debug functionality for timeline wheel gestures.
 * This module can be easily removed once debugging is complete.
 *
 * ## Usage
 *
 * Enable debug mode by adding `?debug=timeline` to the URL.
 *
 * ## API
 *
 * - `initTimelineDebug()` - Initialize debug system (call once)
 * - `logTimelineEvent(event)` - Log a wheel event with before/after context
 * - `isTimelineDebugEnabled()` - Check if debug mode is enabled
 *
 * ## Browser Console
 *
 * - `window.timelineDebug()` - View all events with before→after state
 * - `window.timelineDebugClear()` - Clear logs
 */

// =============================================================================
// Types
// =============================================================================

export interface DebugContext {
  entityStart?: string;
  entityEnd?: string;
  now?: string;
  effectiveStart: string;
  effectiveEnd: string;
  currentStartPercent: number;
  windowLeft?: number;
  windowRight?: number;
  // Invalid zone debug info (calculated)
  leftInvalidWidth?: number;
  rightInvalidWidth?: number;
  leftInvalidBuckets?: number;
  rightInvalidBuckets?: number;
  combinedInvalidBuckets?: number;
  // DOM measurements (rendered)
  dom?: {
    containerWidth: number; // px
    barWidth: number; // px (actual rendered bar width)
    leftInvalidWidthPx: number; // px
    rightInvalidWidthPx: number; // px
  };
}

export interface WheelDebugEvent {
  timestamp: number;
  dx: number;
  dy: number;
  effectiveDelta: number;
  isZoom: boolean;
  wasBlocked: boolean;
  blockReason?: string;
  asymmetricApplied?: boolean;
  wasConstrained?: boolean;
  oldRange: { start: string; end: string };
  newRange: { start: string; end: string };
  beforeContext?: DebugContext;
  afterContext?: DebugContext;
}

// =============================================================================
// State
// =============================================================================

const wheelDebugLog: WheelDebugEvent[] = [];
const MAX_DEBUG_LOG_SIZE = 10; // Keep memory bounded
let isDebugEnabled = false;
let debugInitialized = false;

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if debug mode is enabled.
 */
export function isTimelineDebugEnabled(): boolean {
  return isDebugEnabled;
}

/**
 * Initialize the debug system (call once on mount).
 * Checks URL params and sets up window functions.
 */
export function initTimelineDebug(): void {
  if (debugInitialized) return;
  debugInitialized = true;

  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  isDebugEnabled = params.get("debug") === "timeline" || params.get("debug") === "true";

  if (isDebugEnabled) {
    console.log(
      "[Timeline Debug] ✅ ENABLED\n" +
        "  • window.timelineDebug() - view all events with before→after state\n" +
        "  • window.timelineDebugClear() - clear logs",
    );

    // Expose debug function globally
    (window as unknown as Record<string, () => void>).timelineDebug = () => {
      console.table(
        wheelDebugLog.map((e) => {
          const beforeLeft = e.beforeContext?.leftInvalidBuckets?.toFixed(1) || "-";
          const afterLeft = e.afterContext?.leftInvalidBuckets?.toFixed(1) || "-";
          const beforeRight = e.beforeContext?.rightInvalidBuckets?.toFixed(1) || "-";
          const afterRight = e.afterContext?.rightInvalidBuckets?.toFixed(1) || "-";
          const beforeCombined = e.beforeContext?.combinedInvalidBuckets?.toFixed(1) || "-";
          const afterCombined = e.afterContext?.combinedInvalidBuckets?.toFixed(1) || "-";

          const beforeBarWidth = e.beforeContext?.dom?.barWidth.toFixed(1) || "-";
          const afterBarWidth = e.afterContext?.dom?.barWidth.toFixed(1) || "-";
          const beforeLeftPx = e.beforeContext?.dom?.leftInvalidWidthPx.toFixed(0) || "-";
          const afterLeftPx = e.afterContext?.dom?.leftInvalidWidthPx.toFixed(0) || "-";
          const beforeRightPx = e.beforeContext?.dom?.rightInvalidWidthPx.toFixed(0) || "-";
          const afterRightPx = e.afterContext?.dom?.rightInvalidWidthPx.toFixed(0) || "-";

          return {
            time: new Date(e.timestamp).toLocaleTimeString(),
            type: e.isZoom ? "ZOOM" : "PAN",
            status: e.wasBlocked ? "BLOCKED" : e.asymmetricApplied ? "ASYMMETRIC" : "OK",
            reason: e.blockReason || "-",
            "L buckets": `${beforeLeft}→${afterLeft}`,
            "R buckets": `${beforeRight}→${afterRight}`,
            "Total buckets": `${beforeCombined}→${afterCombined}`,
            "Bar width (px)": `${beforeBarWidth}→${afterBarWidth}`,
            "L px": `${beforeLeftPx}→${afterLeftPx}`,
            "R px": `${beforeRightPx}→${afterRightPx}`,
          };
        }),
      );
      console.log("\nFull details (last 10):", wheelDebugLog);
      console.log("\nTo copy:", JSON.stringify(wheelDebugLog, null, 2));
    };

    (window as unknown as Record<string, () => void>).timelineDebugClear = () => {
      wheelDebugLog.length = 0;
      console.log("[Timeline Debug] Logs cleared");
    };
  } else {
    console.log("[Timeline Debug] ❌ DISABLED - add ?debug=timeline to URL to enable");
  }
}

/**
 * Log a wheel event with before/after context.
 * Automatically filters out useless events (0 delta).
 */
export function logTimelineEvent(event: WheelDebugEvent): void {
  if (!isDebugEnabled) return;

  // Skip useless events (0 delta = no movement)
  if (event.effectiveDelta === 0) return;

  wheelDebugLog.push(event);

  // Keep only last N events (bounded memory)
  if (wheelDebugLog.length > MAX_DEBUG_LOG_SIZE) {
    wheelDebugLog.shift();
  }
}
