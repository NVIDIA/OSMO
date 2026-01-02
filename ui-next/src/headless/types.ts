/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
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
 *
 * Generic filter primitives (ActiveFilter, SetFilterResult, etc.) are
 * provided by lib/filters. This module defines domain-specific filter
 * type unions for resources, pools, etc.
 */

// Re-export generic ActiveFilter from lib/filters
// This ensures a single source of truth for the type shape
export type { ActiveFilter } from "@/lib/filters";

// =============================================================================
// Domain-Specific Filter Types
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
 * Filter types available on the All Resources page.
 * (Includes pool filter for cross-pool filtering)
 */
export type AllResourcesFilterType = "search" | "pool" | "platform" | "resourceType";

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
