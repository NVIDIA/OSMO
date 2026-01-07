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
 * Production stub for debug utilities.
 *
 * This file replaces debug.ts in production builds via webpack alias.
 * All functions are no-ops to ensure zero runtime cost.
 *
 * @see next.config.ts for the alias configuration
 */

// Import and re-export debug event type from constants for type safety
import type { DebugEventType } from "../constants";
export type { DebugEventType };

export interface DebugSnapshot {
  event: DebugEventType;
  timestamp: string;
  duration?: number;
  columnIds: string[];
  containerWidth: number | null;
  columnSizing: Record<string, number>;
  preferences: Record<string, { mode: string; width: number }>;
  minSizes: Record<string, number>;
  preferredSizes: Record<string, number>;
  isResizing: boolean;
  isInitialized: boolean;
  context?: Record<string, unknown>;
  error?: string;
}

// No-op implementations - zero runtime cost
export function logColumnSizingDebug(_snapshotOrFactory: DebugSnapshot | (() => DebugSnapshot)): void {}

export function flushDebugBuffer(): void {}

export function createDebugSnapshot(
  _event: DebugEventType,
  _state: {
    columnIds: string[];
    containerRef?: React.RefObject<HTMLElement | null>;
    columnSizing: Record<string, number>;
    preferences?: Record<string, { mode: string; width: number }>;
    minSizes: Record<string, number>;
    preferredSizes: Record<string, number>;
    isResizing: boolean;
    isInitialized: boolean;
  },
  _context?: Record<string, unknown>,
  _error?: string,
): DebugSnapshot {
  // Return empty object - this function is never actually called in production
  // because logColumnSizingDebug (which uses lazy evaluation) is a no-op
  return {} as DebugSnapshot;
}

export function measureTiming<T>(_label: string, fn: () => T, _state: unknown): T {
  return fn();
}
