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

import { useMemo, useState } from "react";

import { useWindowSize } from "usehooks-ts";

import { FilterButton } from "~/components/FilterButton";
import PageHeader from "~/components/PageHeader";
import { PieChart } from "~/components/PieChart";
import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { type ProfileResponse } from "~/models";
import { WorkflowStatusValues, type WorkflowStatusType } from "~/models/workflows-model";
import { api } from "~/trpc/react";

import { AggregatePanels } from "../pools/components/AggregatePanels";
import { PoolStatus } from "../pools/components/PoolStatus";
import { processPoolsQuotaResponse } from "../pools/models/PoolListitem";

const getStatusColor = (status: WorkflowStatusType) => {
  if (status.startsWith("FAILED")) {
    return { bgColor: "var(--color-error-bg-reversed)", textColor: "var(--color-error-text-reversed)" };
  }
  if (status === "COMPLETED") {
    return { bgColor: "var(--color-tag-bg-completed)", textColor: "var(--color-tag-text-completed)" };
  }
  if (status === "PENDING") {
    return { bgColor: "var(--color-pending-bg-reversed)", textColor: "var(--color-pending-text)" };
  }
  if (status === "RUNNING") {
    return { bgColor: "var(--color-pool-bg-reversed)", textColor: "var(--color-pool-text-reversed)" };
  }
  return { bgColor: "black", textColor: "white" };
};

interface PieSlice {
  status: WorkflowStatusType;
  value: number;
  bgColor: string;
  textColor: string;
}

export default function Dashboard() {
  const { height } = useWindowSize();
  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });
  const [selectedPool, setSelectedPool] = useState<string | undefined>(profile?.profile.pool ?? undefined);

  const {
    data: nodeSets,
    isSuccess: poolsIsSuccess,
    isLoading: poolsIsLoading,
  } = api.resources.getPoolsQuota.useQuery(
    {
      all_pools: true,
    },
    {
      refetchOnWindowFocus: false,
    },
  );

  const { pools } = useMemo(() => {
    return processPoolsQuotaResponse(poolsIsSuccess, nodeSets);
  }, [nodeSets, poolsIsSuccess]);

  const poolDetails = useMemo(() => {
    return pools.find((pool) => pool.name === selectedPool);
  }, [pools, selectedPool]);

  const {
    data: workflows,
    isSuccess: workflowsIsSuccess,
    isFetching: isFetchingWorkflows,
  } = api.workflows.getList.useQuery(
    {
      all_users: true,
      users: [],
      all_pools: true,
      pools: [],
      submitted_after: undefined,
      submitted_before: undefined,
      statuses: [],
      name: "",
      priority: undefined,
    },
    {
      refetchOnWindowFocus: false,
    },
  );
  const [showFilters, setShowFilters] = useState(false);

  const processWorkflows = useMemo((): PieSlice[] => {
    if (!workflowsIsSuccess) {
      return [];
    }

    const data: PieSlice[] = WorkflowStatusValues.map((status) => {
      const count = workflows.filter((workflow) => workflow.status === status).length;
      const { bgColor, textColor } = getStatusColor(status as WorkflowStatusType);

      return {
        status,
        value: count,
        bgColor,
        textColor,
      };
    });

    return data;
  }, [workflows, workflowsIsSuccess]);

  return (
    <>
      <PageHeader>
        <FilterButton
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterCount={0}
          aria-controls="dashboard-filters"
        />
      </PageHeader>
      <div className={`flex md:flex-row flex-wrap w-full md:h-full gap-global p-global`}>
        <section
          className="flex flex-col body-component md:h-full w-full md:w-auto"
          aria-labelledby="pool-details-title"
        >
          <div className={`popup-header brand-header`}>
            <h2 id="pool-details-title">Pool</h2>
            <Select
              id="pool-select"
              value={selectedPool ?? ""}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setSelectedPool(e.target.value);
              }}
              aria-label="Select a pool"
            >
              {profile?.pools.map((pool) => (
                <option
                  key={pool}
                  value={pool}
                >
                  {pool}
                </option>
              ))}
            </Select>
          </div>
          <div className="dag-details-body p-global sm:h-full sm:overflow-y-auto">
            {poolDetails && (
              <div className="flex flex-col">
                <PoolStatus status={poolDetails.status} />
                <p>{poolDetails.description}</p>
                {poolDetails.resource_usage && (
                  <AggregatePanels
                    totals={poolDetails.resource_usage}
                    isLoading={false}
                    isShowingUsed
                  />
                )}
              </div>
            )}
          </div>
        </section>
        <section
          className="flex flex-col body-component md:h-full grow"
          aria-labelledby="workflows-title"
        >
          <div className={`popup-header brand-header items-center`}>
            <h2 id="workflows-title">Workflows</h2>
          </div>
          {isFetchingWorkflows ? (
            <Spinner
              size="large"
              description="Loading..."
            />
          ) : (
            <PieChart
              data={
                processWorkflows.map((slice) => ({
                  label: slice.status,
                  value: slice.value,
                  bgColor: slice.bgColor,
                  textColor: slice.textColor,
                })) ?? []
              }
              size={height / 2}
              innerRadius="50%"
              gapDegrees={0}
              title="Workflows"
              onSliceClick={(slice, index) => {
                console.log(slice, index);
              }}
            />
          )}
        </section>
      </div>
    </>
  );
}
