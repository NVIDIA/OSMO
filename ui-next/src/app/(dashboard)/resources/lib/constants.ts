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

// Re-export from canonical locations
export { PANEL } from "@/components/panel";
export { TABLE_ROW_HEIGHTS } from "@/lib/config";

// Layout constants specific to resources table
// Note: Use TABLE_ROW_HEIGHTS from @/lib/config for row heights.
// This LAYOUT object is for legacy compatibility only.
export const LAYOUT = {
  HEADER_HEIGHT: 41,
  ROW_HEIGHT: 48,
  ROW_HEIGHT_COMPACT: 32,
} as const;

// =============================================================================
// Resource Allocation Type Display
// =============================================================================

/**
 * Display configuration for resource allocation types.
 * Used for consistent styling of resource type badges across the UI.
 */
export const ResourceAllocationTypeDisplay = {
  RESERVED: {
    label: "Reserved",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  SHARED: {
    label: "Shared",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  UNUSED: {
    label: "Unused",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
} as const;

/**
 * Helper to get resource allocation type display configuration.
 * Handles unknown values gracefully.
 */
export function getResourceAllocationTypeDisplay(type: string) {
  return (
    ResourceAllocationTypeDisplay[type as keyof typeof ResourceAllocationTypeDisplay] ??
    ResourceAllocationTypeDisplay.UNUSED
  );
}
