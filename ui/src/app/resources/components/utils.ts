//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import { convertFields, roundResources, ResourcesEntrySchema } from "~/models";

import { type AggregateProps } from "./AggregatePanels";
import { type ResourceListItem } from "./ResourceDetails";

export const calcResourceUsages = (resources: unknown): ResourceListItem[] => {
  const parsedResponse = z.array(ResourcesEntrySchema).safeParse(resources);

  if (!parsedResponse.success) {
    console.error(parsedResponse.error);
    return [];
  }

  return parsedResponse.data.flatMap((resource) => {
    const poolPlatformMap = (resource.exposed_fields["pool/platform"] ?? []).reduce(
      (acc, poolPlatform) => {
        const [poolName, platformName] = poolPlatform.split("/");
        if (poolName && platformName) {
          acc[poolName] = [...(acc[poolName] ?? []), platformName];
        }
        return acc;
      },
      {} as Record<string, string[]>,
    );

    return Object.entries(poolPlatformMap).flatMap(([poolName, platforms]) =>
      platforms.map((platform) => ({
        node: resource.exposed_fields.node ?? "-",
        pool: poolName,
        platform,
        storage: roundResources(convertFields("storage", resource, poolName, platform)),
        cpu: roundResources(convertFields("cpu", resource, poolName, platform)),
        memory: roundResources(convertFields("memory", resource, poolName, platform)),
        gpu: roundResources(convertFields("gpu", resource, poolName, platform)),
        resourceType: resource.resource_type ?? "-",
      })),
    );
  });
};

export const calcAggregateTotals = (resources: ResourceListItem[]) => {
  const total: AggregateProps = {
    cpu: { allocatable: 0, usage: 0 },
    gpu: { allocatable: 0, usage: 0 },
    storage: { allocatable: 0, usage: 0 },
    memory: { allocatable: 0, usage: 0 },
  };
  const byPool: Record<string, AggregateProps> = {};
  const processedNodes = new Set<string>();
  const processedPoolNodes = new Set<string>();

  resources.forEach((item) => {
    const poolKey = item.pool || "N/A";
    const poolNodeKey = `${poolKey}:${item.node}`;

    if (!processedPoolNodes.has(poolNodeKey)) {
      const poolTotals = byPool[poolKey] ?? {
        cpu: { allocatable: 0, usage: 0 },
        gpu: { allocatable: 0, usage: 0 },
        storage: { allocatable: 0, usage: 0 },
        memory: { allocatable: 0, usage: 0 },
      };

      poolTotals.cpu.allocatable += item.cpu.allocatable;
      poolTotals.cpu.usage += item.cpu.usage;
      poolTotals.gpu.allocatable += item.gpu.allocatable;
      poolTotals.gpu.usage += item.gpu.usage;
      poolTotals.storage.allocatable += item.storage.allocatable;
      poolTotals.storage.usage += item.storage.usage;
      poolTotals.memory.allocatable += item.memory.allocatable;
      poolTotals.memory.usage += item.memory.usage;

      byPool[poolKey] = poolTotals;
      processedPoolNodes.add(poolNodeKey);
    }

    if (!processedNodes.has(item.node)) {
      total.cpu.allocatable += item.cpu.allocatable;
      total.cpu.usage += item.cpu.usage;
      total.gpu.allocatable += item.gpu.allocatable;
      total.gpu.usage += item.gpu.usage;
      total.storage.allocatable += item.storage.allocatable;
      total.storage.usage += item.storage.usage;
      total.memory.allocatable += item.memory.allocatable;
      total.memory.usage += item.memory.usage;

      processedNodes.add(item.node);
    }
  });

  return { byPool, total };
};

