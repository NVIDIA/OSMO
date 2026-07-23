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

import type { Resource } from "@/lib/api/adapter/types";

export interface ResourceSelectionState {
  resourceName: string;
  poolName: string | null;
}

export function getResourceRowId(resource: Resource): string {
  return `${resource.backend}/${resource.name}`;
}

export function findResourceForSelection(
  resources: Resource[],
  resourceName: string | null,
  configuredPool: string | null,
): Resource | undefined {
  if (!resourceName) return undefined;

  const matchingResources = resources.filter((resource) => resource.name === resourceName);
  if (configuredPool) {
    const poolMatch = matchingResources.find((resource) =>
      resource.poolMemberships.some((membership) => membership.pool === configuredPool),
    );
    if (poolMatch) return poolMatch;
  }

  return matchingResources[0];
}

export function getResourceSelectionState(resource: Resource, configuredPool: string | null): ResourceSelectionState {
  const poolName = resource.poolMemberships.some((membership) => membership.pool === configuredPool)
    ? configuredPool
    : (resource.poolMemberships[0]?.pool ?? null);

  return { resourceName: resource.name, poolName };
}
