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
import { type PoolResourceUsage } from "~/models";

export interface AggregateProps {
  totals?: PoolResourceUsage;
  isLoading: boolean;
  isShowingUsed: boolean;
}

export const AggregatePanels: React.FC<AggregateProps> = ({ totals, isLoading, isShowingUsed }) => {
  const gauges = useMemo(() => {
    return (
      <>
        <GaugeCard
          key="Quota"
          label={`Quota ${isShowingUsed ? "Used" : "Free"}`}
          value={{ usage: totals?.quota_used ?? 0, allocatable: totals?.quota_limit ?? 0 }}
          isLoading={isLoading}
          isShowingUsed={isShowingUsed}
          role="listitem"
        />
        <GaugeCard
          key="Total"
          label={`Total ${isShowingUsed ? "Used" : "Free"}`}
          value={{ usage: totals?.total_usage ?? 0, allocatable: totals?.total_capacity ?? 0 }}
          isLoading={isLoading}
          isShowingUsed={isShowingUsed}
          role="listitem"
        />
      </>
    );
  }, [totals, isLoading, isShowingUsed]);

  return gauges;
};
