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

import { useState, useReducer, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/shadcn/popover";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { DateRangePicker, type DateRangePickerResult } from "@/components/date-range-picker/date-range-picker";
import { useUtilizationData } from "@/hooks/use-utilization-data";
import { type MetricKey, type RawUtilizationBucket, TIER_MS, ceilToHour } from "@/lib/api/adapter/utilization";
import { parseDateRangeValue } from "@/lib/date-range-utils";
import { formatCompact, formatBytes, cn } from "@/lib/utils";
import { MONTHS_SHORT } from "@/lib/format-date";

const chartConfig = {
  gpu: { label: "GPUs", color: "var(--chart-gpu)" },
  cpu: { label: "CPUs", color: "var(--chart-cpu)" },
  memory: { label: "Memory", color: "var(--chart-memory)" },
  storage: { label: "Storage", color: "var(--chart-storage)" },
} satisfies ChartConfig;

type PresetKey = "1d" | "3d" | "7d" | "14d" | "30d";

const RANGE_PRESETS: { key: PresetKey; label: string; ms: number }[] = [
  { key: "1d", label: "1d", ms: TIER_MS["1d"] },
  { key: "3d", label: "3d", ms: TIER_MS["3d"] },
  { key: "7d", label: "7d", ms: TIER_MS["7d"] },
  { key: "14d", label: "14d", ms: TIER_MS["14d"] },
  { key: "30d", label: "30d", ms: TIER_MS["30d"] },
];

const DEFAULT_PRESET: PresetKey = "7d";

const METRICS: MetricKey[] = ["gpu", "cpu", "memory", "storage"];

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

function rangeFromPreset(key: PresetKey): { start: number; end: number } {
  const end = ceilToHour(Date.now());
  const ms = RANGE_PRESETS.find((p) => p.key === key)?.ms ?? TIER_MS["7d"];
  return { start: end - ms, end };
}

type RangeState =
  | { preset: PresetKey; range: { start: number; end: number }; from: ""; to: "" }
  | { preset: null; range: { start: number; end: number }; from: string; to: string };

type RangeAction =
  | { type: "preset"; key: PresetKey }
  | { type: "custom"; range: { start: number; end: number }; from: string; to: string };

function rangeReducer(_: RangeState, action: RangeAction): RangeState {
  switch (action.type) {
    case "preset":
      return { preset: action.key, range: rangeFromPreset(action.key), from: "", to: "" };
    case "custom":
      return { preset: null, range: action.range, from: action.from, to: action.to };
  }
}

export function UtilizationChart() {
  const [rangeState, dispatchRange] = useReducer(rangeReducer, null, () => ({
    preset: DEFAULT_PRESET,
    range: rangeFromPreset(DEFAULT_PRESET),
    from: "" as const,
    to: "" as const,
  }));
  const [activeMetric, setActiveMetric] = useState<MetricKey>("gpu");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { range } = rangeState;
  const displayStartMs = range.start;
  const displayEndMs = range.end;

  const { buckets, truncated, isLoading, error, refetch, granularityMs } = useUtilizationData({
    displayStartMs,
    displayEndMs,
  });

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

  const isCustom = rangeState.preset === null;

  const handlePresetClick = useCallback((key: PresetKey) => {
    dispatchRange({ type: "preset", key });
  }, []);

  const handleCustomCommit = useCallback((result: DateRangePickerResult) => {
    const parsed = parseDateRangeValue(result.value);
    if (parsed && parsed.end > parsed.start) {
      const [from = "", to = ""] = result.value.split("..");
      dispatchRange({ type: "custom", range: { start: parsed.start.getTime(), end: parsed.end.getTime() }, from, to });
      setPopoverOpen(false);
    }
  }, []);

  return (
    <InlineErrorBoundary title="Unable to load utilization chart">
      <Card className="gap-0 rounded-lg border-zinc-200 py-0 shadow-none dark:border-zinc-800 dark:bg-zinc-950">
        <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 lg:flex-row">
          {/* Left: title + range controls */}
          <div className="flex flex-1 flex-col justify-center gap-4 px-6 py-5 sm:py-6">
            <CardTitle>Resource Utilization</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-zinc-200 dark:border-zinc-800">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handlePresetClick(p.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium transition-colors",
                      "first:rounded-l-md last:rounded-r-md",
                      !isCustom && rangeState.preset === p.key
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
                    initialFrom={rangeState.from}
                    initialTo={rangeState.to}
                    onCommit={handleCustomCommit}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Right: metric tabs */}
          <div className="flex self-stretch border-t lg:border-t-0">
            {METRICS.map((metric) => (
              <button
                key={metric}
                type="button"
                onClick={() => setActiveMetric(metric)}
                data-active={activeMetric === metric}
                className="group relative z-30 flex flex-1 flex-col justify-center gap-1 border-l px-6 py-4 text-left first:border-l-0 last:rounded-tr-lg data-[active=true]:bg-zinc-900 data-[active=true]:text-white lg:border-l lg:px-8 lg:py-6 lg:first:border-l dark:data-[active=true]:bg-zinc-100 dark:data-[active=true]:text-zinc-900"
              >
                <span className="text-muted-foreground text-xs group-data-[active=true]:text-inherit group-data-[active=true]:opacity-80">
                  {chartConfig[metric].label}
                </span>
                <span className="text-lg leading-none font-bold whitespace-nowrap sm:text-2xl">
                  {isLoading ? "—" : METRIC_TOTAL_FORMAT[metric](totals[metric])}
                </span>
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-4 pr-2 pb-1 pl-0 sm:pt-6 sm:pr-4 sm:pb-2">
          {isLoading ? (
            <div className="flex h-[250px] flex-col gap-3 px-6">
              <Skeleton className="h-full w-full rounded-md" />
              <Skeleton className="mx-auto h-3 w-2/3 rounded-md" />
            </div>
          ) : error ? (
            <div className="flex h-[250px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-muted-foreground text-sm">Failed to load utilization data</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Retry
              </button>
            </div>
          ) : buckets.length === 0 ? (
            <div className="flex h-[250px] flex-col items-center justify-center gap-1 text-center">
              <p className="text-muted-foreground text-sm">No utilization data for this range</p>
              <p className="text-muted-foreground/60 text-xs">Try selecting a different time range</p>
            </div>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={buckets}
                margin={{ left: 16, right: 24 }}
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
                  width={40}
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
