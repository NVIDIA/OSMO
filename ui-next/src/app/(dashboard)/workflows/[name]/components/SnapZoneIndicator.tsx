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
 * Snap Zone Indicator Component
 *
 * Visual feedback during panel drag showing snap zone behavior.
 * - Soft zone (80%): Blue indicator, no auto-action
 * - Full zone (90%): Green indicator, triggers DAG hide on release
 */

import { memo } from "react";
import type { SnapZone } from "../lib/panel-state-machine";

interface SnapZoneIndicatorProps {
  zone: SnapZone | null;
  isDragging: boolean;
}

export const SnapZoneIndicator = memo(function SnapZoneIndicator({ zone, isDragging }: SnapZoneIndicatorProps) {
  if (!isDragging || !zone) return null;

  const label = zone === "soft" ? "Release to snap to 80%" : "Release to hide DAG";

  return (
    <div
      className="snap-zone-indicator"
      data-zone={zone}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
});
