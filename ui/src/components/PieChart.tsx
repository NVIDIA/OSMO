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

export interface PieSlice {
  id?: string;
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  slices: PieSlice[];
  size?: number;
  innerRadius?: number;
  className?: string;
  ariaLabel?: string;
  onSliceSelect?: (slice: PieSlice, index: number) => void;
  centerLabel?: string;
  centerValue?: string | number;
}

const polarToCartesian = (cx: number, cy: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number, innerRadius = 0) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  if (innerRadius > 0) {
    const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
    const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);
    return [
      `M ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");
  }

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
};

const defaultAriaLabel = (slice: PieSlice, percent: number) =>
  `${slice.label}: ${slice.value} (${percent.toFixed(1)}%)`;

export const PieChart = ({
  slices,
  size = 160,
  innerRadius = 0,
  className,
  ariaLabel = "Pie chart",
  onSliceSelect,
  centerLabel,
  centerValue,
}: PieChartProps) => {
  const normalizedSlices = slices.filter((slice) => slice.value > 0);
  const total = normalizedSlices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2;
  const center = radius;

  let currentAngle = 0;

  return (
    <svg
      role="list"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ overflow: "visible" }}
    >
      <style>
        {`
          .pie-slice-path {
            transform-origin: 50% 50%;
            transform-box: view-box;
            transition: transform 120ms ease;
          }
          .pie-slice-path.is-clickable {
            cursor: pointer;
          }
          .pie-slice-path.is-clickable:hover {
            transform: scale(1.02);
          }
        `}
      </style>
      {normalizedSlices.map((slice, index) => {
        const sliceAngle = (slice.value / total) * 360;
        const startAngle = currentAngle;
        const endAngle = currentAngle + sliceAngle;
        currentAngle = endAngle;

        const path = describeArc(center, center, radius, startAngle, endAngle, innerRadius);
        const percent = (slice.value / total) * 100;
        const ariaSliceLabel = defaultAriaLabel(slice, percent);

        return (
          <g
            key={slice.id ?? `${slice.label}-${index}`}
            role="listitem"
            aria-label={ariaSliceLabel}
            onClick={() => onSliceSelect?.(slice, index)}
          >
            <path
              d={path}
              fill={slice.color ?? "black"}
              className={`pie-slice-path${onSliceSelect ? " is-clickable" : ""}`}
              stroke="white"
              strokeWidth={1}
            >
              <title>{ariaSliceLabel}</title>
            </path>
          </g>
        );
      })}
      {innerRadius > 0 && (centerValue ?? centerLabel) && (
        <g aria-hidden="true">
          {centerValue !== undefined && centerValue !== null && (
            <text
              x={center}
              y={center}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-[black] text-base font-semibold"
            >
              {centerValue}
            </text>
          )}
          {centerLabel && (
            <text
              x={center}
              y={center + 16}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-[var(--colors-displayFgLowPrimary)] text-xs"
            >
              {centerLabel}
            </text>
          )}
        </g>
      )}
    </svg>
  );
};
