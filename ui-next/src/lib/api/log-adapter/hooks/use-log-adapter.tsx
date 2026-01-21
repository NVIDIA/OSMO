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
 * useLogAdapter Hook
 *
 * Provides access to the log adapter singleton instance.
 */

"use client";

import { PlainTextAdapter } from "../adapters/plain-text-adapter";

// =============================================================================
// Singleton Adapter
// =============================================================================

let defaultAdapter: PlainTextAdapter | null = null;

/**
 * Gets or creates the default PlainTextAdapter.
 * Uses singleton pattern for shared caching across components.
 */
function getDefaultAdapter(): PlainTextAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new PlainTextAdapter();
  }
  return defaultAdapter;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the log adapter singleton.
 *
 * @returns PlainTextAdapter instance
 */
export function useLogAdapter(): PlainTextAdapter {
  return getDefaultAdapter();
}
