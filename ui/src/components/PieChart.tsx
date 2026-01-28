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
import { type KeyboardEvent, useState } from "react";

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
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const normalizedSlices = slices.filter((slice) => slice.value > 0);
  const total = normalizedSlices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2;
  const center = radius;

  let currentAngle = 0;

  const handleSliceKeyDown = (event: KeyboardEvent<SVGGElement>, slice: PieSlice, index: number) => {
    if (!onSliceSelect) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSliceSelect(slice, index);
    }
  };

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
          .pie-slice {
            outline: none;
          }
          .pie-slice-path {
            transform-origin: 50% 50%;
            transform-box: view-box;
            transition: transform 120ms ease;
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
        const midAngle = (startAngle + endAngle) / 2;
        const focusOffset = 4;
        const midAngleRadians = ((midAngle - 90) * Math.PI) / 180;
        const focusTranslateX = -Math.cos(midAngleRadians) * focusOffset;
        const focusTranslateY = -Math.sin(midAngleRadians) * focusOffset;
        const isFocused = focusedIndex === index;
        const focusTransform = isFocused
          ? `translate(${focusTranslateX}px, ${focusTranslateY}px) scale(1.08)`
          : undefined;

        return (
          <g
            key={slice.id ?? `${slice.label}-${index}`}
            className="pie-slice"
            role="button"
            tabIndex={0}
            aria-label={ariaSliceLabel}
            onClick={() => onSliceSelect?.(slice, index)}
            onKeyDown={(event) => handleSliceKeyDown(event, slice, index)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex((prev) => (prev === index ? null : prev))}
          >
            <path
              d={path}
              fill={slice.color ?? "black"}
              className="pie-slice-path"
              stroke="white"
              strokeWidth={1}
              style={focusTransform ? { transform: focusTransform } : undefined}
            >
              <title>{ariaSliceLabel}</title>
            </path>
          </g>
        );
      })}
      {focusedIndex !== null &&
        normalizedSlices[focusedIndex] &&
        (() => {
          let angle = 0;
          for (let i = 0; i < focusedIndex; i += 1) {
            const sliceAtIndex = normalizedSlices[i];
            if (!sliceAtIndex) {
              continue;
            }
            angle += (sliceAtIndex.value / total) * 360;
          }
          const slice = normalizedSlices[focusedIndex];
          const sliceAngle = (slice.value / total) * 360;
          const startAngle = angle;
          const endAngle = angle + sliceAngle;
          const focusOffset = 4;
          const focusInnerThickness = innerRadius / 10;
          const focusOuterThickness = -innerRadius / 10;
          const midAngle = (startAngle + endAngle) / 2;
          const midAngleRadians = ((midAngle - 90) * Math.PI) / 180;
          const focusTranslateX = -Math.cos(midAngleRadians) * focusOffset;
          const focusTranslateY = -Math.sin(midAngleRadians) * focusOffset;
          const focusedOuterRadius = radius + focusOuterThickness;
          const focusedInnerRadius = Math.max(0, innerRadius - focusInnerThickness);
          const path = describeArc(center, center, focusedOuterRadius, startAngle, endAngle, focusedInnerRadius);

          return (
            <g
              className="pie-slice"
              aria-hidden="true"
              style={{ pointerEvents: "none" }}
            >
              <path
                d={path}
                fill={slice.color ?? "black"}
                className="pie-slice-path"
                stroke="white"
                strokeWidth={1}
                style={{ transform: `translate(${focusTranslateX}px, ${focusTranslateY}px) scale(1.08)` }}
              />
            </g>
          );
        })()}
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
