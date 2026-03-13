// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState, useMemo, useCallback } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/shadcn/chart";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/shadcn/popover";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import {
  DateRangePicker,
  type DateRangePickerResult,
  type DateRangePresetItem,
} from "@/components/date-range-picker/date-range-picker";
import { useUtilizationData } from "@/hooks/use-utilization-data";
import { type MetricKey, type RawUtilizationBucket, TIER_MS, autoGranularityMs } from "@/lib/api/adapter/utilization";
import { formatCompact, formatBytes, cn } from "@/lib/utils";
import { MONTHS_SHORT } from "@/lib/format-date";

// =============================================================================
// Chart Config
// =============================================================================

const chartConfig = {
  gpu: { label: "GPUs", color: "var(--chart-gpu)" },
  cpu: { label: "CPUs", color: "var(--chart-cpu)" },
  memory: { label: "Memory", color: "var(--chart-memory)" },
  storage: { label: "Storage", color: "var(--chart-storage)" },
} satisfies ChartConfig;

// =============================================================================
// Presets
// =============================================================================

type PresetKey = "1d" | "3d" | "7d" | "14d" | "30d";

const RANGE_PRESETS: { key: PresetKey; label: string; ms: number }[] = [
  { key: "1d", label: "1d", ms: TIER_MS["1d"] },
  { key: "3d", label: "3d", ms: TIER_MS["3d"] },
  { key: "7d", label: "7d", ms: TIER_MS["7d"] },
  { key: "14d", label: "14d", ms: TIER_MS["14d"] },
  { key: "30d", label: "30d", ms: TIER_MS["30d"] },
];

const DEFAULT_PRESET: PresetKey = "7d";

// =============================================================================
// Formatting helpers
// =============================================================================

const METRIC_TOTAL_FORMAT: Record<MetricKey, (v: number) => string> = {
  gpu: (v) => `${formatCompact(v)}\u00B7h`,
  cpu: (v) => `${formatCompact(v)}\u00B7h`,
  memory: (v) => `${formatBytes(v).display}\u00B7h`,
  storage: (v) => `${formatBytes(v).display}\u00B7h`,
};

const METRIC_FORMAT: Record<MetricKey, (v: number) => string> = {
  gpu: (v) => `${formatCompact(v)} GPUs`,
  cpu: (v) => `${formatCompact(v)} CPUs`,
  memory: (v) => formatBytes(v).display,
  storage: (v) => formatBytes(v).display,
};

function formatXAxisTick(timestampMs: number, granularityMs: number): string {
  const d = new Date(timestampMs);
  const mon = MONTHS_SHORT[d.getMonth()];
  const day = d.getDate();
  const hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  if (granularityMs <= 3_600_000) {
    return `${mon} ${day}, ${h12} ${ampm}`;
  }
  return `${mon} ${day}`;
}

function formatTooltipTime(timestampMs: number, granularityMs: number): string {
  const d = new Date(timestampMs);
  const mon = MONTHS_SHORT[d.getMonth()];
  const day = d.getDate();
  const fmtTime = (date: Date) => {
    const h = date.getHours();
    const m = date.getMinutes().toString().padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${m} ${ap}`;
  };

  if (granularityMs <= 3_600_000) {
    return `${mon} ${day}, ${fmtTime(d)}`;
  }
  const endD = new Date(timestampMs + granularityMs);
  return `${mon} ${day}, ${fmtTime(d)} – ${fmtTime(endD)}`;
}

const datePickerPresets: DateRangePresetItem[] = RANGE_PRESETS.map((p) => ({
  label: p.label,
  getValue: () => {
    const now = new Date();
    const start = new Date(now.getTime() - p.ms);
    return `${start.toISOString().slice(0, 10)}..${now.toISOString().slice(0, 10)}`;
  },
}));

// =============================================================================
// Component
// =============================================================================

function rangeFromPreset(key: PresetKey): { start: number; end: number } {
  const now = Date.now();
  const ms = RANGE_PRESETS.find((p) => p.key === key)?.ms ?? TIER_MS["7d"];
  return { start: now - ms, end: now };
}

export function UtilizationChart() {
  const [activePreset, setActivePreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [activeMetric, setActiveMetric] = useState<MetricKey>("gpu");
  const [range, setRange] = useState(rangeFromPreset(DEFAULT_PRESET));
  const [popoverOpen, setPopoverOpen] = useState(false);

  const displayStartMs = range.start;
  const displayEndMs = range.end;

  const { buckets, truncated, isLoading } = useUtilizationData({ displayStartMs, displayEndMs });

  const rangeMs = displayEndMs - displayStartMs;
  const granularityMs = autoGranularityMs(rangeMs);

  const totals = useMemo(() => {
    const hours = granularityMs / 3_600_000;
    const result = { gpu: 0, cpu: 0, memory: 0, storage: 0 };
    for (const b of buckets) {
      result.gpu += b.gpu * hours;
      result.cpu += b.cpu * hours;
      result.memory += b.memory * hours;
      result.storage += b.storage * hours;
    }
    return result;
  }, [buckets, granularityMs]);

  const isCustom = !RANGE_PRESETS.some((p) => p.key === activePreset && range.end - range.start === p.ms);

  const handlePresetClick = useCallback((key: PresetKey) => {
    setActivePreset(key);
    setRange(rangeFromPreset(key));
  }, []);

  const handleCustomCommit = useCallback(
    (result: DateRangePickerResult) => {
      const { value } = result;
      if (value.includes("..")) {
        const [fromStr, toStr] = value.split("..");
        const start = new Date(fromStr.includes("T") ? fromStr : `${fromStr}T00:00:00`).getTime();
        const end = new Date(toStr.includes("T") ? toStr : `${toStr}T23:59:59`).getTime();
        if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
          setRange({ start, end });
          setPopoverOpen(false);
        }
      } else {
        const preset = RANGE_PRESETS.find((p) => p.label === value);
        if (preset) {
          handlePresetClick(preset.key);
          setPopoverOpen(false);
        }
      }
    },
    [handlePresetClick],
  );

  const metrics: MetricKey[] = ["gpu", "cpu", "memory", "storage"];

  return (
    <InlineErrorBoundary title="Unable to load utilization chart">
      <Card>
        <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
          {/* Left: title + range controls */}
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
            <CardTitle>Resource Utilization</CardTitle>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex rounded-md border border-zinc-200 dark:border-zinc-800">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handlePresetClick(p.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium transition-colors",
                      "first:rounded-l-md last:rounded-r-md",
                      !isCustom && activePreset === p.key
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Popover
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      isCustom
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                    )}
                  >
                    Custom
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                >
                  <DateRangePicker
                    presets={datePickerPresets}
                    onCommit={handleCustomCommit}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Right: metric tabs */}
          <div className="flex">
            {metrics.map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setActiveMetric(metric)}
                data-active={activeMetric === metric || undefined}
                className={cn(
                  "relative z-10 flex flex-1 flex-col justify-center gap-1 border-t border-l px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6",
                  "data-[active]:bg-muted/50",
                )}
              >
                <span className="text-muted-foreground text-xs">{chartConfig[metric].label}</span>
                <span className="text-lg leading-none font-bold sm:text-xl">
                  {isLoading ? "—" : METRIC_TOTAL_FORMAT[metric](totals[metric])}
                </span>
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="px-2 sm:p-6">
          {isLoading ? (
            <Skeleton className="aspect-video w-full" />
          ) : (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={buckets}
                margin={{ left: 12, right: 12 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value: number) => formatXAxisTick(value, granularityMs)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: number) => {
                    if (activeMetric === "memory" || activeMetric === "storage") {
                      return formatBytes(value).display;
                    }
                    return formatCompact(value);
                  }}
                  width={60}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_label, payload) => {
                        const items = payload as Array<{ payload?: RawUtilizationBucket }> | undefined;
                        const ts = items?.[0]?.payload?.timestamp;
                        if (ts == null) return "";
                        return formatTooltipTime(ts, granularityMs);
                      }}
                      formatter={(value) => {
                        const numVal = typeof value === "number" ? value : Number(value);
                        return METRIC_FORMAT[activeMetric](numVal);
                      }}
                    />
                  }
                />
                <Area
                  dataKey={activeMetric}
                  type="natural"
                  fill={`var(--color-${activeMetric})`}
                  fillOpacity={0.2}
                  stroke={`var(--color-${activeMetric})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          )}
          {truncated && (
            <p className="text-muted-foreground mt-2 text-center text-xs">
              Data may be incomplete — too many tasks in this range.
            </p>
          )}
        </CardContent>
      </Card>
    </InlineErrorBoundary>
  );
}
