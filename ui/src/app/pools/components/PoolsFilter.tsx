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

import { OutlinedIcon } from "~/components/Icon";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { Spinner } from "~/components/Spinner";
import { PoolsListResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export const PoolsFilter = ({
  isSelectAllPoolsChecked,
  selectedPools,
  updateUrl,
  onRefresh,
}: {
  isSelectAllPoolsChecked: boolean;
  selectedPools: string;
  updateUrl: (props: ToolParamUpdaterProps) => void;
  onRefresh: () => void;
}) => {
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [localAllPools, setLocalAllPools] = useState<boolean>(isSelectAllPoolsChecked);

  const { data: availablePools, isLoading: isLoadingPools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: !localAllPools,
  });

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
  }, [isSelectAllPoolsChecked]);

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

  const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name)
      .join(",");

    updateUrl({
      pools,
      allPools: localAllPools,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-global p-global">
        <MultiselectWithAll
          id="pools"
          label="All Pools"
          placeholder="Filter by pool name..."
          aria-label="Filter by pool name"
          filter={localPools}
          setFilter={(pools) => {
            setLocalPools(pools);
          }}
          onSelectAll={setLocalAllPools}
          isSelectAllChecked={localAllPools}
          showAll={true}
        />
        {isLoadingPools && !localAllPools && <Spinner size="small" />}
      </div>
      <div className="flex flex-row gap-global justify-between body-footer p-global">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLocalPools(new Map(Array.from(localPools.keys()).map((key) => [key, false])));
            setLocalAllPools(true);
            updateUrl({
              pools: "",
              allPools: true,
            });
          }}
        >
          <OutlinedIcon name="undo" />
          Reset
        </button>
        <button
          type="submit"
          className="btn btn-primary"
        >
          <OutlinedIcon name="refresh" />
          Refresh
        </button>
      </div>
    </form>
  );
};
