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
 * Timeline Context
 *
 * Provides timeline state and configuration to child components via React Context.
 * Eliminates prop drilling and enables cleaner component composition.
 *
 * ## Usage
 *
 * ```tsx
 * // In parent component
 * <TimelineProvider value={timelineContext}>
 *   <TimelineHistogram />
 *   <TimelineWindow />
 * </TimelineProvider>
 *
 * // In child component
 * const { currentDisplay, actions } = useTimelineContext();
 * ```
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import type { useTimelineState } from "../hooks/use-timeline-state";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration passed to timeline components.
 */
export interface TimelineConfig {
  /** Whether interactive draggers are enabled */
  enableInteractiveDraggers: boolean;
  /** Entity start time (workflow/task start) */
  entityStartTime?: Date;
  /** Entity end time (workflow/task end) */
  entityEndTime?: Date;
  /** Whether end time is considered "NOW" */
  isEndTimeNow: boolean;
}

/**
 * Data passed to timeline components.
 */
export interface TimelineData {
  /** Active histogram buckets (pending or committed) */
  buckets: HistogramBucket[];
  /** Pending buckets (if available) */
  pendingBuckets?: HistogramBucket[];
  /** Original display start (for transform calculation) */
  displayStart?: Date;
  /** Original display end (for transform calculation) */
  displayEnd?: Date;
}

/**
 * Full timeline context value.
 */
export interface TimelineContextValue {
  /** Timeline state from useTimelineState hook */
  state: ReturnType<typeof useTimelineState>;
  /** Configuration options */
  config: TimelineConfig;
  /** Data for rendering */
  data: TimelineData;
  /** Container ref for gesture handling */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// =============================================================================
// Context
// =============================================================================

const TimelineContext = createContext<TimelineContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface TimelineProviderProps {
  value: TimelineContextValue;
  children: ReactNode;
}

export function TimelineProvider({ value, children }: TimelineProviderProps): ReactNode {
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Access timeline context. Must be used within TimelineProvider.
 *
 * @throws Error if used outside of TimelineProvider
 */
export function useTimelineContext(): TimelineContextValue {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("useTimelineContext must be used within TimelineProvider");
  }
  return context;
}

/**
 * Access timeline context, returning null if not available.
 * Use this for optional context access (e.g., in reusable components).
 */
export function useTimelineContextOptional(): TimelineContextValue | null {
  return useContext(TimelineContext);
}
