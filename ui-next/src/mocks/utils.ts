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
 * Mock Handler Utilities
 *
 * Common utilities for MSW request handlers to reduce duplication.
 * These follow MSW 2.0 patterns and provide type-safe parsing.
 */

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationParams {
  offset: number;
  limit: number;
}

/**
 * Parse pagination parameters from URL search params.
 * Returns sensible defaults if not provided.
 */
export function parsePagination(url: URL, defaults?: Partial<PaginationParams>): PaginationParams {
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = parseInt(url.searchParams.get("limit") || String(defaults?.limit ?? 20), 10);

  return {
    offset: isNaN(offset) ? 0 : Math.max(0, offset),
    limit: isNaN(limit) ? (defaults?.limit ?? 20) : Math.max(1, Math.min(limit, 1000)),
  };
}

// ============================================================================
// Filter Parsing
// ============================================================================

export interface WorkflowFilters {
  statuses: string[];
  pools: string[];
  users: string[];
}

/**
 * Parse workflow filter parameters from URL search params.
 */
export function parseWorkflowFilters(url: URL): WorkflowFilters {
  return {
    statuses: url.searchParams.getAll("statuses"),
    pools: url.searchParams.getAll("pools"),
    users: url.searchParams.getAll("users"),
  };
}

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(filters: WorkflowFilters): boolean {
  return filters.statuses.length > 0 || filters.pools.length > 0 || filters.users.length > 0;
}

// ============================================================================
// Mock Delay
// ============================================================================

/**
 * Get the appropriate mock delay for the current environment.
 * Minimal in development for fast iteration, larger in test/CI.
 */
export function getMockDelay(): number {
  return process.env.NODE_ENV === "development" ? 5 : 50;
}

// ============================================================================
// Hash Utility
// ============================================================================

/**
 * Simple string hash for deterministic seeding.
 * Used across generators for consistent random data.
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash;
}
