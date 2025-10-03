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
import { type Pool, type PoolResourceUsage, PoolsQuotaResponseSchema } from "~/models";

export interface PoolListItem extends Pool {
  sharedPools: string[];
}

export const poolToPoolListItem = (pool: Pool, nodeSetPools?: string[]): PoolListItem => {
  return {
    ...pool,
    sharedPools: nodeSetPools?.filter((n) => n !== pool.name) ?? [],
  };
};

export const processPoolsQuotaResponse = (isSuccess: boolean, nodeSets: unknown): { pools: PoolListItem[]; totalResources?: PoolResourceUsage } => {
  if (!isSuccess) {
    return { pools: [], totalResources: undefined };
  }

  const parsedResponse = PoolsQuotaResponseSchema.safeParse(nodeSets);

  if (!parsedResponse.success) {
    console.error(parsedResponse.error);
    return { pools: [], totalResources: undefined };
  }

  return {
    pools: parsedResponse.data.node_sets.flatMap((nodeSet) => {
      // nodeSet.pools is an array of Pool objects
      const nodeSetPools = nodeSet.pools.map((pool) => pool.name);
      return nodeSet.pools.map((pool) => poolToPoolListItem(pool, nodeSetPools));
    }),
    totalResources: parsedResponse.data.resource_sum,
  };
};
