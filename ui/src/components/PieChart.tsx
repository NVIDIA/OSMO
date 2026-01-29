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
  borderColor?: string;
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

const describeFullCircle = (cx: number, cy: number, radius: number, innerRadius = 0) => {
  const startOuter = polarToCartesian(cx, cy, radius, 0);
  const midOuter = polarToCartesian(cx, cy, radius, 180);
  if (innerRadius > 0) {
    const startInner = polarToCartesian(cx, cy, innerRadius, 0);
    const midInner = polarToCartesian(cx, cy, innerRadius, 180);
    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${radius} ${radius} 0 1 0 ${midOuter.x} ${midOuter.y}`,
      `A ${radius} ${radius} 0 1 0 ${startOuter.x} ${startOuter.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${midInner.x} ${midInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${startInner.x} ${startInner.y}`,
      "Z",
    ].join(" ");
  }
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${radius} ${radius} 0 1 0 ${midOuter.x} ${midOuter.y}`,
    `A ${radius} ${radius} 0 1 0 ${startOuter.x} ${startOuter.y}`,
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
  const isEmpty = normalizedSlices.length === 0;
  const displaySlices = isEmpty ? [{ label: "Empty", value: 1 }] : normalizedSlices;
  const total = displaySlices.reduce((sum, slice) => sum + slice.value, 0);
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
      {displaySlices.map((slice, index) => {
        const sliceAngle = (slice.value / total) * 360;
        const startAngle = currentAngle;
        const endAngle = currentAngle + sliceAngle;
        currentAngle = endAngle;

        const path = isEmpty
          ? describeFullCircle(center, center, radius, innerRadius)
          : describeArc(center, center, radius, startAngle, endAngle, innerRadius);
        const displayValue = isEmpty ? 0 : slice.value;
        const percent = isEmpty ? 100 : (slice.value / total) * 100;
        const ariaSliceLabel = defaultAriaLabel({ ...slice, value: displayValue }, percent);

        return (
          <g
            key={slice.id ?? `${slice.label}-${index}`}
            role="listitem"
            aria-label={ariaSliceLabel}
            onClick={() => onSliceSelect?.(slice, index)}
          >
            <path
              d={path}
              fill={slice.color ?? "lightgray"}
              className={`pie-slice-path${onSliceSelect ? " is-clickable" : ""}`}
              stroke={slice.borderColor ?? slice.color ?? "lightgray"}
              strokeWidth={1}
            >
              <title>{ariaSliceLabel}</title>
            </path>
          </g>
        );
      })}
      {innerRadius > 0 && (isEmpty || centerValue !== undefined || centerLabel) && (
        <g aria-hidden="true">
          {(isEmpty || centerValue !== undefined) && centerValue !== null && (
            <text
              x={center}
              y={center - 8}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-[black] text-base font-semibold"
            >
              {isEmpty ? 0 : centerValue}
            </text>
          )}
          {centerLabel && (
            <text
              x={center}
              y={center + 8}
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
