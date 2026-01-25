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
 * Timeline Module
 *
 * Colocated components and hooks for the timeline histogram feature.
 * This module handles time range selection, visualization, and interaction.
 *
 * ## Architecture (2-Layer Model)
 *
 * The timeline uses a 2-layer architecture:
 *
 * **Layer 1 (Pannable Content):**
 *   [invalidZoneLeft] <---> [histogram bars] <---> [invalidZoneRight]
 *
 *   - All elements pan together as a single unit
 *   - Rendered by TimelineHistogram (internal component)
 *
 * **Layer 2 (Fixed Window):**
 *   [left overlay] | <----- viewport -----> | [right overlay]
 *
 *   - Stays fixed while Layer 1 pans underneath
 *   - Rendered by TimelineWindow (internal component)
 *
 * ## Public API
 *
 * - **TimelineContainer**: Main component - orchestrates state, gestures, and composition
 *   - Use this component in your application
 *   - Handles all state management and gesture handling
 *   - Composes TimelineHistogram + TimelineWindow + TimelineControls
 *
 * ## Internal Components
 *
 * - TimelineHistogram: Pure presentation component (Layer 1 content)
 * - TimelineWindow: Fixed window overlay (Layer 2 content)
 * - InvalidZone: Striped areas beyond entity boundaries
 * - TimelineControls: Apply/Cancel buttons
 * - useTimelineState: State management hook
 * - useTimelineGestures: Gesture handling hooks
 * - timeline-utils: Pure calculation functions
 */

// Public API - Main component
export { TimelineContainer } from "./TimelineContainer";
export type { TimelineContainerProps, TimeRangePreset } from "./TimelineContainer";

// Note: All internal components, hooks, and utilities are NOT exported.
// They are implementation details of TimelineContainer.
// Use TimelineContainer as the public API.
