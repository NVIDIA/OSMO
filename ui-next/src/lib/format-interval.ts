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
 * Format a refresh interval in milliseconds to a compact human-readable string.
 *
 * @returns "Off" for 0, "10s"/"30s" for sub-minute, "2m"/"5m" for minutes
 */
export function formatInterval(ms: number): string {
  if (ms === 0) return "Off";
  if (ms < 60_000) return `${ms / 1000}s`;
  return `${ms / 60_000}m`;
}
