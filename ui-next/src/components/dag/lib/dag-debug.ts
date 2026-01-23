/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DAG Debugging Utility
 *
 * Provides console logging for tracking performance-critical events in the DAG visualization.
 * Gated by ?debug=true URL parameter.
 */

export type DAGEventType =
  | "LAYOUT_START"
  | "LAYOUT_END"
  | "RENDER_START"
  | "RENDER_END"
  | "VIEWPORT_ANIMATION_START"
  | "VIEWPORT_ANIMATION_END"
  | "VIEWPORT_ANIMATION_CANCELLED"
  | "DOM_RESIZE"
  | "READINESS_SIGNAL"
  | "STATE_COMMIT"
  | "AUTOPAN_START"
  | "AUTOPAN_END"
  | "AUTOPAN_SKIPPED"
  | "CENTERING_START"
  | "CENTERING_END"
  | "DIMENSION_CHANGE_SKIPPED"
  | "CLAMPING_SKIPPED";

class DAGEventLogger {
  private isEnabled: boolean = false;

  enable() {
    this.isEnabled = true;
    if (process.env.NODE_ENV === "development") {
      console.log("[DAG-DEBUG] Debug logging enabled");
    }
  }

  disable() {
    this.isEnabled = false;
  }

  log(type: DAGEventType, payload?: Record<string, unknown>) {
    if (!this.isEnabled || process.env.NODE_ENV !== "development") return;

    console.log(`[DAG-DEBUG] ${type}`, payload ?? "");
  }
}

export const dagDebug = new DAGEventLogger();
