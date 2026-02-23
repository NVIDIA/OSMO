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
 * Shared panel configuration for resizable detail panels.
 * Used by pools, resources, workflows/DAG panels.
 */
export const PANEL = {
  /** Minimum width percentage */
  MIN_WIDTH_PCT: 33,
  /** Overlay maximum width percentage */
  OVERLAY_MAX_WIDTH_PCT: 80,
  /** Maximum width percentage (100 for auto-snap zones) */
  MAX_WIDTH_PCT: 100,
  /** Default panel width percentage */
  DEFAULT_WIDTH_PCT: 50,
  /** Width of collapsed panel strip in pixels */
  COLLAPSED_WIDTH_PX: 40,
} as const;
