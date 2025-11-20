//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
import React, { type FC, useMemo, useState } from "react";

type PieDatum = {
  label: string;
  value: number;
  bgColor?: string;
  textColor?: string;
};

export type PieChartProps = {
  data: PieDatum[];
  size?: number;
  innerRadius?: number | string; // px, fraction (0..1), or percentage string like "60%"
  gapDegrees?: number; // small gap between slices in degrees
  ariaLabel?: string;
  className?: string;
  showLegend?: boolean;
  legendClassName?: string;
  title?: string;
  onSliceClick?: (slice: PieDatum, index: number) => void;
  vertical?: boolean;
};

function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function describeArc(cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, endAngle);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  // Draw outer arc, then line to inner arc, then inner arc back, and close
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArcFlag} 1 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

function resolveInnerRadius(value: number | string | undefined, outerR: number): number {
  if (value == null) return 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const pct = parseFloat(trimmed.slice(0, -1));
      if (Number.isFinite(pct) && pct >= 0) {
        return (outerR * Math.min(pct, 100)) / 100;
      }
      return 0;
    }
    const asNum = parseFloat(trimmed);
    if (Number.isFinite(asNum)) {
      // Treat plain numeric strings as px
      return Math.max(0, asNum);
    }
    return 0;
  }
  // number: if between 0..1 treat as fraction of outerR; otherwise px
  if (value >= 0 && value <= 1) {
    return outerR * value;
  }
  return Math.max(0, value);
}

export const PieChart: FC<PieChartProps> = ({
  data,
  size = 160,
  innerRadius = 0,
  gapDegrees = 0.5,
  ariaLabel = "Pie chart",
  className = "",
  showLegend = true,
  legendClassName = "",
  title,
  onSliceClick,
  vertical = false,
}) => {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const filtered = data.filter((d) => Number.isFinite(d.value) && d.value > 0);
  const total = filtered.reduce((sum, d) => sum + d.value, 0);
  const radius = size ? size / 2 : 0;
  // Allow headroom to scale focused slice without clipping by slightly reducing base radius
  const focusScale = 1.01;
  const growthPadding = Math.ceil(radius * (focusScale - 1) + 2);
  const outerR = Math.max(0, radius - growthPadding);
  const desiredInnerR = resolveInnerRadius(innerRadius, outerR);
  const innerR = Math.max(0, Math.min(desiredInnerR, outerR - 2));
  const hasDonutHole = innerR > 0;
  const viewBox = `0 0 ${size} ${size}`;
  const focusGrow = Math.max(
    0,
    Math.min(growthPadding, hasDonutHole ? Math.floor((outerR - innerR) / 2) - 1 : growthPadding),
  );

  const slices = useMemo(() => {
    if (total <= 0) {
      return [];
    }

    let startAngle = 0;
    const result: Array<PieDatum & { startAngle: number; endAngle: number; percentage: number }> = [];

    filtered.forEach((d, idx) => {
      const pct = d.value / total;
      const sliceAngle = 360 * pct;
      const gap = gapDegrees > 0 ? Math.min(gapDegrees, sliceAngle * 0.2) : 0;
      const sa = startAngle + (idx === 0 ? 0 : gap / 2);
      const ea = startAngle + sliceAngle - (idx === filtered.length - 1 ? 0 : gap / 2);
      result.push({
        ...d,
        startAngle: sa,
        endAngle: ea,
        percentage: pct * 100,
      });
      startAngle += sliceAngle;
    });
    return result;
  }, [filtered, total, gapDegrees]);

  return (
    <div className={`grid ${vertical ? "grid-rows-1" : "grid-cols-2"} gap-global items-center ${className}`}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={viewBox}
        width={typeof size === "number" ? size : "100%"}
        height={typeof size === "number" ? size : "100%"}
      >
        <title>{ariaLabel}</title>
        {total <= 0 ? (
          <>
            <circle
              cx={radius}
              cy={radius}
              r={outerR}
              fill={hasDonutHole ? "#e5e7eb" : "#f3f4f6"}
            />
            {hasDonutHole && (
              <circle
                cx={radius}
                cy={radius}
                r={innerR}
                fill="white"
              />
            )}
          </>
        ) : (
          <>
            {hasDonutHole && (
              <circle
                cx={radius}
                cy={radius}
                r={innerR}
                fill="white"
              />
            )}
            {slices.map((s, i) => {
              const isFocused = focusedIndex === i;
              const rOut = outerR + (isFocused ? focusGrow : 0);
              const rIn = hasDonutHole ? Math.max(0, innerR - (isFocused ? focusGrow : 0)) : 0;
              const path = describeArc(radius, radius, rOut, rIn, s.startAngle, s.endAngle);
              const color = s.bgColor ?? "black";
              const midAngle = (s.startAngle + s.endAngle) / 2;
              const mid = polarToCartesian(radius, radius, (rIn + rOut) / 2, midAngle);
              const label = `${s.label}: ${s.value} (${s.percentage.toFixed(1)}%)`;
              return (
                <g
                  key={s.label}
                  onClick={onSliceClick ? () => onSliceClick(s, i) : undefined}
                  onKeyDown={
                    onSliceClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSliceClick(s, i);
                          }
                        }
                      : undefined
                  }
                  onFocus={() => setFocusedIndex(i)}
                  onBlur={() => setFocusedIndex((curr) => (curr === i ? null : curr))}
                  role="button"
                  tabIndex={showLegend ? -1 : 0}
                  aria-label={label}
                  style={{ cursor: "pointer", outline: "none" }}
                >
                  <path
                    d={path}
                    fill={color}
                  >
                    <title>{label}</title>
                  </path>
                  {s.percentage >= 2 && (
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.max(10, size * 0.05)}
                      fill={s.textColor ?? "white"}
                    >
                      {s.value}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        )}
        {hasDonutHole && (
          <text
            x={radius}
            y={radius}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(10, size * 0.08)}
            fontWeight={600}
          >
            {title}
          </text>
        )}
      </svg>
      {showLegend && filtered.length > 0 && (
        <ul className={legendClassName}>
          {filtered.map((d, i) => {
            const color = d.bgColor ?? "black";

            return (
              <li
                key={d.label}
                className="list-none"
              >
                <button
                  className={`outline-none flex items-center gap-global p-1 border-1 w-full ${i === focusedIndex ? "shadow-md border-border" : "border-transparent"}`}
                  onClick={() => onSliceClick?.(d, i)}
                  onFocus={() => setFocusedIndex(i)}
                  onBlur={() => setFocusedIndex((curr) => (curr === i ? null : curr))}
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{d.label}</span>
                  <span className="ml-auto tabular-num">{d.value}</span>
                </button>
              </li>
            );
          })}
          <li className="list-none flex items-center gap-global w-full p-1">
            <span className="w-3 h-3 rounded-sm bg-black" />
            <span className="font-bold truncate">TOTAL</span>
            <span className="ml-auto tabular-num">{total}</span>
          </li>
        </ul>
      )}
    </div>
  );
};
