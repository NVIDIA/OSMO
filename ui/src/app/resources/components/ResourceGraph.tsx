//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";

import { BarChart, type BarDatum } from "~/components/BarChart";
import { Spinner } from "~/components/Spinner";

import { type AggregateProps } from "./AggregatePanels";

interface ResourceGraphProps extends AggregateProps {
  isLoading: boolean;
  isEditing: boolean;
  isShowingUsed: boolean;
  width?: number;
  height?: number;
}

const buildBarValue = (allocatable: number, usage: number, isShowingUsed: boolean) => {
  if (allocatable <= 0) {
    return 0;
  }
  const usedPercent = (usage / allocatable) * 100;
  const freePercent = ((allocatable - usage) / allocatable) * 100;
  return Math.max(0, isShowingUsed ? usedPercent : freePercent);
};

const getUsageColor = (allocatable: number, usage: number) => {
  if (allocatable <= 0) {
    return "var(--color-neutral-bg)";
  }
  const percent = (usage / allocatable) * 100;

  if (percent >= 90) {
    return "red";
  }
  if (percent >= 80) {
    return "yellow";
  }
  return "#76b900";
};

const formatUsage = (allocatable: number, usage: number, isShowingUsed: boolean): (string | number)[] => {
  if (isShowingUsed) {
    return [`${usage}/`, allocatable];
  }
  const free = Math.max(0, allocatable - usage);
  return [`${free}/`, allocatable];
};

export const ResourcesGraph = ({
  cpu,
  memory,
  gpu,
  storage,
  isLoading,
  isEditing,
  isShowingUsed,
  width = 250,
  height = 200,
}: ResourceGraphProps) => {
  const data: BarDatum[] = useMemo(
    () => [
      {
        label: "GPU",
        value: buildBarValue(gpu.allocatable, gpu.usage, isShowingUsed),
        color: getUsageColor(gpu.allocatable, gpu.usage),
      },
      {
        label: "Storage",
        value: buildBarValue(storage.allocatable, storage.usage, isShowingUsed),
        color: getUsageColor(storage.allocatable, storage.usage),
      },
      {
        label: "CPU",
        value: buildBarValue(cpu.allocatable, cpu.usage, isShowingUsed),
        color: getUsageColor(cpu.allocatable, cpu.usage),
      },
      {
        label: "Memory",
        value: buildBarValue(memory.allocatable, memory.usage, isShowingUsed),
        color: getUsageColor(memory.allocatable, memory.usage),
      },
    ],
    [cpu, memory, gpu, storage, isShowingUsed],
  );
  const barLabels = useMemo(() => ["GPU", "Storage", "CPU", "Memory"], []);
  const barValues = useMemo(
    () => [
      formatUsage(gpu.allocatable, gpu.usage, isShowingUsed),
      formatUsage(storage.allocatable, storage.usage, isShowingUsed),
      formatUsage(cpu.allocatable, cpu.usage, isShowingUsed),
      formatUsage(memory.allocatable, memory.usage, isShowingUsed),
    ],
    [cpu, gpu, memory, storage, isShowingUsed],
  );

  return (
    <>
      <div
        className={`p-global box-border flex w-full h-full items-center justify-center ${isLoading || isEditing ? "opacity-40" : ""}`}
      >
        <BarChart
          data={data}
          width={width}
          height={height}
          labelAreaHeight={60}
          maxValue={100}
          showTrack={true}
          showAxes={true}
          yAxisTicks={[0, 50, 100]}
          axisLabelWidth={22}
          trackOpacity={0.2}
          ariaLabel={`Aggregate ${isShowingUsed ? "used" : "free"} resources`}
          labelFormatter={(_, index) => barLabels[index] ?? ""}
          valueFormatter={(_, index) => barValues[index] ?? []}
        />
      </div>
      {isLoading && (
        <Spinner
          size="medium"
          className="border-brand absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
      )}
    </>
  );
};

export const ResourceGraph = ResourcesGraph;
