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
import { subDays } from "date-fns";
import format from "date-fns/format";

import { Select } from "./Select";

interface DateRangePickerProps {
  id?: string;
  selectedRange: number;
  setSelectedRange: (range: number) => void;
  fromDate?: string;
  toDate?: string;
  setFromDate: (date?: string) => void;
  setToDate: (date?: string) => void;
  className?: string;
}

export const defaultDateRange = 15;
export const customDateRange = -1;
export const allDateRange = -2;

const dateRangeOptions: { label: string; value: number }[] = [
  { label: "All", value: allDateRange },
  { label: "Today", value: 0 },
  { label: "Last 7 Days", value: 7 },
  { label: `Last ${defaultDateRange} Days`, value: defaultDateRange },
  { label: "Last 30 Days", value: 30 },
  { label: "Last 60 Days", value: 60 },
  { label: "Last 90 Days", value: 90 },
  { label: "Last 180 Days", value: 180 },
  { label: "Last 365 Days", value: 365 },
  { label: "Custom", value: customDateRange },
];

export interface DateRange {
  fromDate?: Date;
  toDate?: Date;
}

export const getBestDateRange = (dateRange: number): number => {
  if (isNaN(dateRange)) {
    return defaultDateRange;
  }

  return dateRangeOptions.find((option) => option.value === dateRange)?.value ?? defaultDateRange;
};

export const getDateFromValues = (dateRange?: number, fromDate?: string, toDate?: string): DateRange => {
  if (dateRange === allDateRange) {
    return {
      fromDate: undefined,
      toDate: undefined,
    };
  }

  const from =
    dateRange === customDateRange && fromDate
      ? fromDate
      : format(subDays(new Date(), dateRange ?? defaultDateRange), "yyyy-MM-dd");
  const to = dateRange === customDateRange && toDate ? toDate : format(new Date(), "yyyy-MM-dd");

  // HTML date format is yyyy-MM-dd. If we convert that to a date it will assume UTC.
  // Building a string with T for local time solves the issue.
  // When calling the API we convert this to UTC using toISOString()
  const result: DateRange = {
    fromDate: new Date(`${from}T00:00:00`),
    toDate: new Date(`${to}T23:59:59`),
  };

  return result;
};

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  id,
  selectedRange,
  setSelectedRange,
  fromDate,
  toDate,
  setFromDate,
  setToDate,
  className,
}) => {
  return (
    <div className={className}>
      <Select
        id={id ?? "date-range"}
        className="w-full"
        value={selectedRange.toString()}
        onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
          setSelectedRange(Number(event.target.value));
        }}
        label="Date Range"
      >
        {dateRangeOptions.map((option) => (
          <option
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </Select>
      {selectedRange === customDateRange && (
        <div className="flex flex-row gap-global items-center w-full justify-between">
          <label className="flex flex-col gap-1">
            From
            <input
              type="date"
              className="w-full"
              value={fromDate}
              max={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => {
                setFromDate(e.target.value.length > 0 ? e.target.value : undefined);
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input
              type="date"
              className="w-full"
              value={toDate}
              min={fromDate}
              max={format(new Date(), "yyyy-MM-dd")}
              onChange={(e) => {
                setToDate(e.target.value.length > 0 ? e.target.value : undefined);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
};
