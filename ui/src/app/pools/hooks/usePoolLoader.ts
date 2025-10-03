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

import { useEffect, useState } from "react";

import { type Pool, PoolsListResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { type PoolListItem, poolToPoolListItem } from "../models/PoolListitem";

export const usePoolLoader = (selectedPool?: string) => {
  const [pool, setPool] = useState<PoolListItem | undefined>(undefined);

  const { data: availablePools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    // The type of parsedAvailablePools is not an array, but a record (object) mapping pool names to pool objects.
    // So, to get an array, use Object.values.
    const parsedData = PoolsListResponseSchema.safeParse(availablePools);
    const parsedAvailablePools: Pool[] = parsedData.success ? Object.values(parsedData.data.pools) : [];
    const pools: PoolListItem[] = parsedAvailablePools.map((p) => poolToPoolListItem(p));

    setPool(pools.find((pool) => pool.name === selectedPool));
  }, [availablePools, selectedPool]);

  return pool;
};
