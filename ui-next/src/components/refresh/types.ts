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

import { AUTO_REFRESH_INTERVALS } from "@/lib/config";

/**
 * Props for RefreshControl and VerticalRefreshControl.
 *
 * Two modes:
 * - Manual-only: provide only onRefresh + isRefreshing
 * - Full auto-refresh: also provide interval + setInterval
 */
export interface RefreshControlProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Current interval in ms. Omit for manual-only mode. */
  interval?: number;
  /** Omit for manual-only mode. */
  setInterval?: (interval: number) => void;
}

/** Dropdown options shared between RefreshControl and VerticalRefreshControl. */
export const INTERVAL_OPTIONS = [
  { value: AUTO_REFRESH_INTERVALS.OFF.toString(), label: "Off" },
  { value: AUTO_REFRESH_INTERVALS.FAST.toString(), label: "10 seconds" },
  { value: AUTO_REFRESH_INTERVALS.REALTIME.toString(), label: "30 seconds" },
  { value: AUTO_REFRESH_INTERVALS.STANDARD.toString(), label: "2 minutes" },
  { value: AUTO_REFRESH_INTERVALS.SLOW.toString(), label: "5 minutes" },
] as const;
