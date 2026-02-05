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
"use client";

import { useEffect, useState } from "react";

import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { Spinner } from "~/components/Spinner";
import { PoolsListResponseSchema } from "~/models";
import { api } from "~/trpc/react";

export const PoolsFilter = ({
  isSelectAllPoolsChecked,
  setIsSelectAllPoolsChecked,
  selectedPools,
  setSelectedPools,
}: {
  isSelectAllPoolsChecked: boolean;
  setIsSelectAllPoolsChecked: (isSelectAllPoolsChecked: boolean) => void;
  selectedPools: string;
  setSelectedPools: (selectedPools: string) => void;
}) => {
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());

  const { data: availablePools, isLoading: isLoadingPools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: !isSelectAllPoolsChecked,
  });

  useEffect(() => {
    const parsedData = PoolsListResponseSchema.safeParse(availablePools);
    const parsedAvailablePools = parsedData.success ? parsedData.data.pools : [];
    const filters = new Map<string, boolean>(Object.keys(parsedAvailablePools).map((pool) => [pool, false]));

    if (!parsedData.success) {
      console.error(parsedData.error);
    }

    if (selectedPools.length) {
      selectedPools.split(",").forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [availablePools, selectedPools]);

  useEffect(() => {
    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name)
      .join(",");

    setSelectedPools(pools);
  }, [localPools, setSelectedPools]);

  return (
    <>
      <MultiselectWithAll
        id="pools"
        label="All Pools"
        placeholder="Filter by pool name..."
        aria-label="Filter by pool name"
        filter={localPools}
        setFilter={setLocalPools}
        onSelectAll={setIsSelectAllPoolsChecked}
        isSelectAllChecked={isSelectAllPoolsChecked}
        showAll={true}
      />
      {isLoadingPools && !isSelectAllPoolsChecked && <Spinner size="small" />}
    </>
  );
};
