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
import { type Row } from "@tanstack/react-table";
import { type FilterFn } from "@tanstack/table-core";

declare module "@tanstack/table-core" {
  interface FilterFns {
    multi?: FilterFn<unknown>;
    multiArray?: FilterFn<unknown>;
    includesStringOrIsNull?: FilterFn<unknown>;
  }
}

export const commonFilterFns = {
  multiArray: (row: Row<unknown>, columnId: string, filterValue?: string[]): boolean => {
    if (!Array.isArray(filterValue)) return true;

    const rowValue = row.getValue(columnId);
    const lowerCaseFilter = filterValue.map((val) => val.toLowerCase());

    if (Array.isArray(rowValue)) {
      return rowValue.some((tag) => lowerCaseFilter.includes(String(tag).toLowerCase()));
    }

    return false;
  },
  multi: (row: Row<unknown>, columnId: string, filterValue?: string[]): boolean => {
    if (!Array.isArray(filterValue) || !filterValue.length) return true;

    const rowValue = row.getValue(columnId);
    const lowerCaseFilter = filterValue.map((val) => val.toLowerCase());

    return typeof rowValue === "string" && lowerCaseFilter.includes(rowValue.toLowerCase());
  },
  includesStringOrIsNull: (row: Row<unknown>, columnId: string, filterValue: string): boolean => {
    if (!filterValue.length) return true;

    const rowValue = row.getValue(columnId);
    return String(rowValue).toLowerCase().includes(filterValue.toLowerCase());
  },
};

