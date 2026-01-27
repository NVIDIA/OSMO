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
"use client";

import { useEffect } from "react";

import { type Table } from "@tanstack/react-table";

import { useTablePageLoader } from "~/hooks/useTablePageLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";

import TablePageRange from "./TablePageRange";

interface TablePaginationProps<TData> {
  table: Table<TData>;
  totalRows: number;
  className?: string;
}

export function TablePagination<TData>({ table, totalRows, className }: TablePaginationProps<TData>) {
  const { pageIndex, pageSize, totalPageCount } = useTablePageLoader(totalRows);
  const updateUrl = useTableStateUrlUpdater();

  useEffect(() => {
    table.setPagination({ pageIndex, pageSize });
  }, [pageIndex, pageSize, table]);

  return (
    <div className={`flex items-center justify-between px-3 py-2 ${className}`}>
      <div className="flex items-center gap-1">
        <label htmlFor="pageSize">Rows per page:</label>
        <select
          id="pageSize"
          value={pageSize}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateUrl({ pageIndex, pageSize: parseInt(event.target.value) });
          }}
        >
          <option value="20">20</option>
          <option value="40">40</option>
          <option value="60">60</option>
        </select>
      </div>
      <TablePageRange
        currentPage={pageIndex + 1}
        maxRangeItems={totalPageCount > 5 ? 5 : totalPageCount}
        pageSize={pageSize}
        setCurrentPage={(currentPage) => {
          updateUrl({ pageIndex: currentPage - 1, pageSize });
        }}
        totalRows={totalRows}
      />
      <div className="flex items-center gap-1">
        <label htmlFor="pageNumber">Page:</label>
        <input
          id="pageNumber"
          type="number"
          value={pageIndex + 1}
          min={1}
          max={totalPageCount}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            updateUrl({ pageIndex: parseInt(event.target.value) - 1, pageSize });
          }}
        />
      </div>
    </div>
  );
}
