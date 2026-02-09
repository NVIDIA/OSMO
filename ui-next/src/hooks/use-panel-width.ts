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

/**
 * usePanelWidth - Manage panel width with clamping
 *
 * Provides width state clamped to max overlay width, plus preset handler.
 * Centralizes the width clamping logic used across all panel pages.
 */

import { useMemo, useCallback } from "react";
import { PANEL } from "@/components/panel/panel-header-controls";

export interface UsePanelWidthOptions {
  /** Stored panel width from store */
  storedWidth: number;
  /** Callback to update stored width */
  setStoredWidth: (width: number) => void;
  /** Maximum width percentage (defaults to PANEL.OVERLAY_MAX_WIDTH_PCT) */
  maxWidth?: number;
}

export interface UsePanelWidthReturn {
  /** Clamped panel width percentage */
  panelWidth: number;
  /** Callback for width changes */
  setPanelWidth: (width: number) => void;
  /** Callback for preset width buttons */
  handleWidthPreset: (pct: number) => void;
}

export function usePanelWidth({
  storedWidth,
  setStoredWidth,
  maxWidth = PANEL.OVERLAY_MAX_WIDTH_PCT,
}: UsePanelWidthOptions): UsePanelWidthReturn {
  const panelWidth = useMemo(() => Math.min(storedWidth, maxWidth), [storedWidth, maxWidth]);
  const handleWidthPreset = useCallback((pct: number) => setStoredWidth(pct), [setStoredWidth]);

  return {
    panelWidth,
    setPanelWidth: setStoredWidth,
    handleWidthPreset,
  };
}
