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
 * Adapter Utilities
 *
 * Shared utility functions for working with resources, pools, and timestamps.
 * Includes workarounds for backend API issues (see BACKEND_TODOS.md).
 */

// =============================================================================
// Timestamp Utilities (BACKEND_TODOS.md Issue #16)
// =============================================================================

/**
 * Normalize a timestamp string to always have explicit UTC timezone.
 *
 * WORKAROUND: Backend may return timestamps without timezone suffix.
 * This normalizes them to always have 'Z' suffix for consistent parsing.
 *
 * IDEAL: Backend should always return ISO 8601 timestamps with explicit
 * timezone, e.g., "2024-01-15T10:30:00Z" or "2024-01-15T10:30:00+00:00"
 *
 * @param timeStr - Timestamp string from backend API
 * @returns Normalized timestamp string with 'Z' suffix, or undefined if input is null/undefined
 *
 * @example
 * ```ts
 * normalizeTimestamp("2024-01-15T10:30:00Z")      // Already UTC - returned as-is
 * normalizeTimestamp("2024-01-15T10:30:00+00:00") // Has offset - returned as-is
 * normalizeTimestamp("2024-01-15T10:30:00")       // No timezone - appends 'Z'
 * normalizeTimestamp(null)                         // Returns undefined
 * ```
 */
export function normalizeTimestamp(timeStr?: string | null): string | undefined {
  if (!timeStr) return undefined;
  // If timestamp has no timezone info, treat it as UTC by appending 'Z'
  const hasTimezone = timeStr.endsWith("Z") || timeStr.includes("+") || timeStr.includes("-", 10);
  return hasTimezone ? timeStr : `${timeStr}Z`;
}

/**
 * Normalize all timestamp fields in a workflow response.
 *
 * WORKAROUND: Backend may return timestamps without timezone suffix.
 * This transforms the response at the API boundary so UI components
 * can safely use `new Date(str)` without worrying about timezone issues.
 *
 * Issue: BACKEND_TODOS.md#16-timestamps-missing-explicit-timezone
 *
 * @param workflow - Raw workflow response from API
 * @returns Workflow with all timestamp fields normalized to have 'Z' suffix
 */
export function normalizeWorkflowTimestamps<T extends Record<string, unknown>>(workflow: T): T {
  if (!workflow) return workflow;

  // List of known timestamp fields
  const timestampFields = [
    "submit_time",
    "start_time",
    "end_time",
    "scheduling_start_time",
    "initializing_start_time",
    "processing_start_time",
    "input_download_start_time",
    "input_download_end_time",
    "output_upload_start_time",
  ];

  // Work with a mutable copy
  const normalized: Record<string, unknown> = { ...workflow };

  // Normalize top-level timestamps
  for (const field of timestampFields) {
    if (field in normalized && typeof normalized[field] === "string") {
      normalized[field] = normalizeTimestamp(normalized[field] as string);
    }
  }

  // Recursively normalize groups
  if ("groups" in normalized && Array.isArray(normalized.groups)) {
    normalized.groups = (normalized.groups as Record<string, unknown>[]).map((group) => {
      const normalizedGroup: Record<string, unknown> = { ...group };
      for (const field of timestampFields) {
        if (field in normalizedGroup && typeof normalizedGroup[field] === "string") {
          normalizedGroup[field] = normalizeTimestamp(normalizedGroup[field] as string);
        }
      }

      // Normalize tasks within group
      if ("tasks" in normalizedGroup && Array.isArray(normalizedGroup.tasks)) {
        normalizedGroup.tasks = (normalizedGroup.tasks as Record<string, unknown>[]).map((task) => {
          const normalizedTask: Record<string, unknown> = { ...task };
          for (const field of timestampFields) {
            if (field in normalizedTask && typeof normalizedTask[field] === "string") {
              normalizedTask[field] = normalizeTimestamp(normalizedTask[field] as string);
            }
          }
          return normalizedTask;
        });
      }

      return normalizedGroup;
    });
  }

  return normalized as T;
}
