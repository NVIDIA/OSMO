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
 * Adapter Utilities
 *
 * Shared utility functions for working with resources and pools.
 */

import type { BackendResourceType } from "@/lib/api/generated";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { Resource } from "./types";

/**
 * Derive unique resource types from a list of resources.
 * Returns types in the canonical order defined by ALL_RESOURCE_TYPES.
 *
 * @param resources - Array of resources to extract types from
 * @returns Array of BackendResourceType values present in the resources
 *
 * @example
 * ```ts
 * const types = deriveResourceTypes(resources);
 * // Returns: ["SHARED", "RESERVED"] (in canonical order)
 * ```
 */
export function deriveResourceTypes(resources: Resource[]): BackendResourceType[] {
  const types = new Set<BackendResourceType>();
  resources.forEach((resource) => types.add(resource.resourceType));
  return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
}
