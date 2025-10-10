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
import { useEffect, useState } from "react";

import GaugeComponent, { type SubArc } from "react-gauge-component";

import { Spinner } from "~/components/Spinner";
import { type ResourceAllocation } from "~/models";

interface GaugeProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ResourceAllocation;
  unit?: string;
  isLoading: boolean;
  isShowingUsed: boolean;
}

export const GaugeCard: React.FC<GaugeProps> = ({ label, value, unit, isLoading, isShowingUsed, ...props }) => {
  const Gauge: React.FC<GaugeProps> = ({ label, value, unit, isLoading, isShowingUsed }) => {
    const numerator = isShowingUsed ? value.usage : value.allocatable - value.usage;
    const percentage = value.allocatable === 0 ? 0 : (numerator / value.allocatable) * 100;
    const [colorArray, setColorArray] = useState<string[]>([]);
    const [subArcs, setSubArcs] = useState<SubArc[]>([]);

    useEffect(() => {
      const colors = ["#76b900", "yellow", "red"];

      setSubArcs(isShowingUsed ? [{ limit: 80 }, { limit: 90 }, {}] : [{ limit: 10 }, { limit: 20 }, {}]);
      setColorArray(isShowingUsed ? colors : colors.reverse());
    }, [isShowingUsed]);

    return (
      <div
        className="flex flex-col card bg-white p-2 relative text-center flex-grow items-center justify-center"
        {...props}
      >
        <p className="font-semibold">
          {label} {unit}
        </p>
        <div
          aria-hidden
          className={`flex justify-center items-center ${isLoading ? "invisible" : "visible"}`}
        >
          <GaugeComponent
            className="scale-70 2xl:scale-85 4xl:scale-100 xl:block mt-[-30px] md:mb-[-10px]"
            value={percentage}
            maxValue={100}
            minValue={0}
            arc={{
              colorArray: colorArray,
              subArcs: subArcs,
              padding: 0.02,
              width: 0.3,
            }}
            labels={{
              valueLabel: {
                style: {
                  fill: "black",
                  fontSize: "25px",
                  textShadow: "none",
                  fontFamily: "var(--font-nvidia-sans)",
                  fontWeight: "500",
                },
              },
              tickLabels: {
                hideMinMax: true,
              },
            }}
            pointer={{ type: "needle" }}
          />
        </div>
        {isLoading && (
          <Spinner
            size="medium"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-brand"
          />
        )}
        <p className={`font-semibold ${isLoading ? "hidden" : "visible"}`}>{`${numerator} / ${value.allocatable}`}</p>
      </div>
    );
  };
  Gauge.displayName = "Gauge";

  return (
    <Gauge
      key={label}
      value={value}
      label={label}
      unit={unit}
      isLoading={isLoading}
      isShowingUsed={isShowingUsed}
    />
  );
};
