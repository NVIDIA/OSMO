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
"use client";
import { useMemo, useState } from "react";

import { PieChart, type PieSlice } from "~/components/PieChart";
import { type WorkflowStatusType, WorkflowStatusValues } from "~/models/workflows-model";

interface WorkflowPieChartProps {
  counts: Partial<Record<WorkflowStatusType, number>>;
  size?: number;
  innerRadius?: number;
  className?: string;
  ariaLabel?: string;
  showTotal?: boolean;
  showLegend?: boolean;
}

const statusColorMap: Record<string, { color: string, borderColor?: string }> = {
  COMPLETED: { color: "var(--color-tag-bg-completed)" },
  FAILED: { color: "var(--color-error-bg-reversed)" },
  PENDING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  RUNNING: { color: "var(--color-pool-bg-reversed)" },
  INITIALIZING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  PROCESSING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  SUBMITTING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  SCHEDULING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  WAITING: { color: "var(--color-pending-bg-reversed)", borderColor: "var(--color-pending-text-reversed)" },
  RESCHEDULED: { color: "var(--color-error-bg)" },
  DEFAULT: { color: "var(--color-tag-bg)" },
};

export const getWorkflowStatusColor = (status: WorkflowStatusType): { color: string, borderColor?: string } => {
  if (status.startsWith("FAILED")) {
    return statusColorMap.FAILED!;
  }
  return statusColorMap[status] ?? statusColorMap.DEFAULT!;
};

export const WorkflowPieChart = ({
  counts,
  size = 220,
  innerRadius = 70,
  className,
  ariaLabel = "Workflow status distribution",
  showTotal = true,
  showLegend = true,
}: WorkflowPieChartProps) => {
  const slices: PieSlice[] = useMemo(
    () =>
      WorkflowStatusValues.map((status) => ({
        label: status,
        value: counts[status] ?? 0,
        color: getWorkflowStatusColor(status).color,
        borderColor: getWorkflowStatusColor(status).borderColor,
      })).filter((slice) => slice.value > 0),
    [counts],
  );

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  return (
    <div className="flex gap-global">
      <PieChart
        slices={slices}
        size={size}
        innerRadius={innerRadius}
        className={className}
        ariaLabel={ariaLabel}
        centerValue={showTotal ? total : undefined}
        centerLabel={showTotal ? "Total" : undefined}
        onSliceSelect={(slice) => setSelectedLabel(slice.label)}
      />
      {showLegend && (
        <div className="flex flex-col gap-2">
          {slices.map((slice) => (
            <div
              key={slice.label}
              className={`flex items-center gap-1 text-xs rounded px-1 ${selectedLabel === slice.label ? "bg-headerbg font-semibold" : ""
                }`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: slice.color, borderColor: slice.borderColor ?? slice.color ?? "black", borderWidth: 1 }}
              />
              <span>{slice.label}</span>
              <span>{slice.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
