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
 * Shared utility functions for working with resources and pools.
 */

import { BackendResourceType } from "@/lib/api/generated";
import type { Resource } from "./types";

/**
 * All possible resource allocation types as an array.
 * Use this instead of hardcoding ["SHARED", "RESERVED", "UNUSED"].
 */
export const ALL_RESOURCE_TYPES = Object.values(BackendResourceType) as BackendResourceType[];

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
