/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Shared types for headless hooks.
 *
 * These types are used across multiple hooks to ensure consistency
 * and type safety for common patterns like filtering.
 */

// =============================================================================
// Filter Types
// =============================================================================

/**
 * All possible filter types used across the application.
 *
 * - search: Text search filter
 * - pool: Filter by pool name (Resources page)
 * - platform: Filter by platform
 * - resourceType: Filter by resource allocation type (SHARED, RESERVED, UNUSED)
 */
export type FilterType = "search" | "pool" | "platform" | "resourceType";

/**
 * Filter types available on the Pool Detail page.
 * (No pool filter since we're already viewing a specific pool)
 */
export type PoolDetailFilterType = "search" | "platform" | "resourceType";

/**
 * Filter types available on the All Resources page.
 * (Includes pool filter for cross-pool filtering)
 */
export type AllResourcesFilterType = "search" | "pool" | "platform" | "resourceType";

/**
 * Represents an active filter that can be displayed and removed.
 *
 * @template T - The filter type union (defaults to all filter types)
 */
export interface ActiveFilter<T extends FilterType = FilterType> {
  /** The type of filter */
  type: T;
  /** The filter value (e.g., pool name, platform name, search term) */
  value: string;
  /** Human-readable label for display in filter chips */
  label: string;
}

// =============================================================================
// Display Mode Types
// =============================================================================

/**
 * Display mode for resource capacity values.
 *
 * - "free": Show available capacity (total - used)
 * - "used": Show used capacity with total as reference
 */
export type ResourceDisplayMode = "free" | "used";
