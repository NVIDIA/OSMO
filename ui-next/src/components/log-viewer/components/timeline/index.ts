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
 * ## Architecture
 *
 * The timeline uses a layered approach:
 * 1. **Histogram bars** (bottom layer) - visualization of log distribution
 * 2. **Invalid zones** (middle layer) - striped areas beyond entity boundaries
 * 3. **Timeline window** (top layer) - viewing portal with panels and grippers
 *
 * ## Components
 * - TimelineHistogram: Main histogram component with time range selection
 * - TimelineWindow: Unified viewing window with panels and grippers
 * - InvalidZone: Striped overlay for areas beyond entity boundaries (also pan boundaries)
 * - TimelineControls: Apply/Cancel buttons for pending changes
 *
 * ## Hooks
 * - useDraggerGesture: Mouse/keyboard interactions for draggers
 * - useTimelineWheel: Mouse wheel pan/zoom interactions
 */

// Components
export { TimelineHistogram } from "./TimelineHistogram";
export type { TimelineHistogramProps, TimeRangePreset } from "./TimelineHistogram";

export { TimelineWindow } from "./TimelineWindow";
export type { TimelineWindowProps } from "./TimelineWindow";

export { InvalidZone } from "./InvalidZone";
export type { InvalidZoneProps } from "./InvalidZone";

export { TimelineControls } from "./TimelineControls";
export type { TimelineControlsProps } from "./TimelineControls";

// Legacy exports (deprecated - use TimelineWindow instead)
export { TimelineDragger } from "./TimelineDragger";
export type { TimelineDraggerProps } from "./TimelineDragger";

export { TimelineOverlay } from "./TimelineOverlay";
export type { TimelineOverlayProps } from "./TimelineOverlay";

// Note: useDraggerGesture and useTimelineWheel are internal hooks
// used only by TimelineHistogram and are not exported
