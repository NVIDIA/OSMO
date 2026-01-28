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
import type { KeyboardEvent } from "react";

export interface BarDatum {
  id?: string;
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  width?: number;
  height?: number;
  barGap?: number;
  labelAreaHeight?: number;
  maxValue?: number;
  showTrack?: boolean;
  trackOpacity?: number;
  showAxes?: boolean;
  yAxisTicks?: number[];
  axisLabelWidth?: number;
  axisBarGap?: number;
  className?: string;
  ariaLabel?: string;
  onBarSelect?: (datum: BarDatum, index: number) => void;
  labelFormatter?: (datum: BarDatum, index: number) => string;
  valueFormatter?: (datum: BarDatum, index: number) => (string | number)[];
}

const defaultAriaLabel = (datum: BarDatum, percent: number) =>
  `${datum.label}: ${datum.value} (${percent.toFixed(1)}%)`;

export const BarChart = ({
  data,
  width = 320,
  height = 160,
  barGap = 8,
  labelAreaHeight = 28,
  maxValue,
  showTrack = false,
  trackOpacity = 0.2,
  showAxes = false,
  yAxisTicks = [0, 50, 100],
  axisLabelWidth = 18,
  axisBarGap = 2,
  className,
  ariaLabel = "Bar chart",
  onBarSelect,
  labelFormatter,
  valueFormatter,
}: BarChartProps) => {
  const normalizedData = data.filter((datum) => datum.value > 0);
  const total = normalizedData.reduce((sum, datum) => sum + datum.value, 0);
  const computedMaxValue = Math.max(1, ...normalizedData.map((datum) => datum.value));
  const maxScale = maxValue ?? computedMaxValue;
  const chartWidth = showAxes ? width - axisLabelWidth - axisBarGap : width;
  const barWidth =
    normalizedData.length > 0
      ? (chartWidth - barGap * (normalizedData.length - 1)) / normalizedData.length
      : chartWidth;
  const bottomPadding = showAxes ? 2 : 0;
  const topPadding = showAxes ? 3 : 0;
  const svgHeight = height + labelAreaHeight + bottomPadding;

  const handleBarKeyDown = (event: KeyboardEvent<SVGGElement>, datum: BarDatum, index: number) => {
    if (!onBarSelect) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onBarSelect(datum, index);
    }
  };

  return (
    <svg
      role="list"
      aria-label={ariaLabel}
      width={width}
      height={svgHeight}
      viewBox={`0 0 ${width} ${svgHeight}`}
      className={className}
    >
      <style>
        {`
          .bar-item {
            outline: none;
          }
        `}
      </style>
      {showAxes && (
        <g aria-hidden="true">
          <line
            x1={axisLabelWidth}
            y1={topPadding}
            x2={axisLabelWidth}
            y2={height + bottomPadding}
            stroke="black"
            strokeWidth={1}
          />
          <line
            x1={axisLabelWidth}
            y1={height + bottomPadding}
            x2={width}
            y2={height + bottomPadding}
            stroke="black"
            strokeWidth={1}
          />
          {yAxisTicks.map((tick) => {
            const clamped = Math.min(Math.max(tick, 0), maxScale);
            const y = height - (clamped / maxScale) * (height - topPadding);
            return (
              <g key={tick}>
                <line
                  x1={axisLabelWidth - 3}
                  y1={y}
                  x2={axisLabelWidth}
                  y2={y}
                  stroke="black"
                  strokeWidth={1}
                />
                <text
                  x={axisLabelWidth - 6}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[black] text-[9px]"
                >
                  {tick}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {normalizedData.map((datum, index) => {
        const barHeight = (datum.value / maxScale) * (height - topPadding);
        const x = (showAxes ? axisLabelWidth + axisBarGap : 0) + index * (barWidth + barGap);
        const y = height - barHeight;
        const percent = total > 0 ? (datum.value / total) * 100 : 0;
        const ariaBarLabel = defaultAriaLabel(datum, percent);
        const labelText = labelFormatter ? labelFormatter(datum, index) : datum.label;
        const valueText = valueFormatter ? valueFormatter(datum, index) : [datum.value];

        return (
          <g
            key={datum.id ?? `${datum.label}-${index}`}
            className="bar-item"
            role="button"
            tabIndex={0}
            aria-label={ariaBarLabel}
            onClick={() => onBarSelect?.(datum, index)}
            onKeyDown={(event) => handleBarKeyDown(event, datum, index)}
          >
            {showTrack && (
              <rect
                x={x}
                y={0}
                width={barWidth}
                height={height}
                fill={datum.color ?? "black"}
                fillOpacity={trackOpacity}
                stroke="white"
                strokeWidth={1}
                rx={2}
              />
            )}
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={datum.color ?? "black"}
              stroke="white"
              strokeWidth={1}
              rx={2}
            >
              <title>{ariaBarLabel}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={height + bottomPadding + 10}
              textAnchor="middle"
              className="fill-[black] text-[10px]"
            >
              {labelText}
              {valueText.map((value, index) => (
                <tspan
                  key={index}
                  x={x + barWidth / 2}
                  dy={10}
                  className="fill-[black] text-[8px]"
                >
                  {value}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
