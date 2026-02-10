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

import { useMounted } from "@/hooks/use-mounted";
import { useLocalStorage } from "usehooks-ts";

export interface AutoRefreshSettings {
  /** Current interval in ms (0 = disabled) */
  interval: number;
  setInterval: (interval: number) => void;
  /** SSR-safe interval: returns 0 until hydrated */
  effectiveInterval: number;
}

/**
 * Per-page auto-refresh settings with localStorage persistence.
 *
 * Interval is the single source of truth: >0 = enabled, 0 = disabled.
 * Returns effectiveInterval=0 during SSR to prevent hydration mismatches.
 */
export function useAutoRefreshSettings(storageKey: string, defaultInterval: number): AutoRefreshSettings {
  const mounted = useMounted();
  const [interval, setInterval] = useLocalStorage(storageKey, defaultInterval);
  const effectiveInterval = mounted && interval > 0 ? interval : 0;

  return { interval, setInterval, effectiveInterval };
}
