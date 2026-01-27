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
import { useMemo } from "react";

import { GaugeCard } from "~/components/Gauge";
import { type ResourceAllocation } from "~/models";

export interface AggregateProps {
  cpu: ResourceAllocation;
  memory: ResourceAllocation;
  gpu: ResourceAllocation;
  storage: ResourceAllocation;
}

export const AggregatePanels: React.FC<AggregateProps & { isLoading: boolean; isShowingUsed: boolean }> = ({
  cpu,
  memory,
  gpu,
  storage,
  isLoading,
  isShowingUsed,
}) => {
  // Gauges for each resource field
  const gauges = useMemo(
    () => [
      <GaugeCard
        key="GPU"
        label="GPU"
        value={gpu}
        unit="[#]"
        isLoading={isLoading}
        isShowingUsed={isShowingUsed}
        role="listitem"
      />,
      <GaugeCard
        key="Storage"
        label="Storage"
        value={storage}
        unit="[Gi]"
        isLoading={isLoading}
        isShowingUsed={isShowingUsed}
        role="listitem"
      />,
      <GaugeCard
        key="CPU"
        label="CPU"
        value={cpu}
        unit="[#]"
        isLoading={isLoading}
        isShowingUsed={isShowingUsed}
        role="listitem"
      />,
      <GaugeCard
        key="Memory"
        label="Memory"
        value={memory}
        unit="[Gi]"
        isLoading={isLoading}
        isShowingUsed={isShowingUsed}
        role="listitem"
      />,
    ],
    [gpu, storage, cpu, memory, isLoading, isShowingUsed],
  );

  return (
    <div
      className="flex flex-col gap-3 p-3 h-full justify-between"
      role="list"
    >
      {gauges}
    </div>
  );
};
