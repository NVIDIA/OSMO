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
 * Simple logger that can be configured for different environments.
 *
 * In production, errors are logged. Warnings are suppressed unless debug mode is enabled.
 * In development, all logs are shown.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Log an error. Always logged.
 */
export function logError(message: string, ...args: unknown[]): void {
  console.error(`[OSMO] ${message}`, ...args);
}

/**
 * Log a warning. Only logged in development.
 */
export function logWarn(message: string, ...args: unknown[]): void {
  if (isDev) {
    console.warn(`[OSMO] ${message}`, ...args);
  }
}
