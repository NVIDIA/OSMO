// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { memo } from "react";
import { MonitorCheck, MonitorX } from "lucide-react";
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import { useSharedPreferences, useDisplayMode } from "@/stores";

/**
 * DisplayModeToggle - Toggle between "free" (available) and "used" display modes.
 *
 * Used by pools and resources tables to filter the view.
 *
 * Note: Uses useDisplayMode (hydration-safe) to prevent mismatch from
 * Zustand's localStorage persistence returning different values on server vs client.
 */
export const DisplayModeToggle = memo(function DisplayModeToggle() {
  // Hydration-safe: returns initial state during SSR/hydration, then actual value
  const displayMode = useDisplayMode();
  const toggleDisplayMode = useSharedPreferences((s) => s.toggleDisplayMode);

  return (
    <SemiStatefulButton
      onClick={toggleDisplayMode}
      currentStateIcon={displayMode === "free" ? <MonitorCheck className="size-4" /> : <MonitorX className="size-4" />}
      nextStateIcon={displayMode === "free" ? <MonitorX className="size-4" /> : <MonitorCheck className="size-4" />}
      label={displayMode === "free" ? "Show Used" : "Show Available"}
      aria-label={displayMode === "free" ? "Currently showing available" : "Currently showing used"}
    />
  );
});
