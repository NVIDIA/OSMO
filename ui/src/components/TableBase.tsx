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

import { useEffect, useRef, useState } from "react";

import { type ColumnDef, flexRender, type Table } from "@tanstack/react-table";

import { CheckboxWithLabel } from "./Checkbox";
import FullPageModal from "./FullPageModal";
import { OutlinedIcon } from "./Icon";
import { Spinner } from "./Spinner";

export function TableBase<TData, TValue>({
  columns,
  table,
  isLoading,
  children,
  className,
}: {
  columns: ColumnDef<TData, TValue>[];
  table: Table<TData>;
  isLoading?: boolean;
  children?: React.ReactNode;
  className?: string;
  visible?: boolean;
}) {
  const containerRef = useRef<HTMLTableSectionElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const pagination = table.getState().pagination;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (containerRef?.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [pagination.pageSize, table, pagination.pageIndex]);

  return (
    <div className={`relative h-full w-full overflow-auto ${className}`}>
      <div
        ref={containerRef}
        className={`relative flex h-full justify-between flex-col`}
      >
        <table
          className="border-separate border-spacing-y-0 h-full items-baseline"
          aria-rowcount={table.getRowModel().rows.length}
        >
          <thead
            className="body-header sticky top-0 z-20"
            ref={headerRef}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => {
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      <div className="flex flex-row gap-global justify-between">
                        {header.column.getCanSort() ? (
                          <button
                            className="btn btn-action gap-0"
                            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                              header.column.toggleSorting(undefined, event.shiftKey);
                            }}
                            title="Click to sort. Hold SHIFT and click on another header to sort by multiple columns."
                          >
                            <span>
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            <span className="w-2 ml-1 mt-[-4px]">
                              {header.column.getIsSorted() === "asc"
                                ? "↓"
                                : header.column.getIsSorted() === "desc"
                                  ? "↑"
                                  : null}
                            </span>
                          </button>
                        ) : header.isPlaceholder ? null : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                        {index === headerGroup.headers.length - 1 && (
                          <button
                            className={`btn btn-action`}
                            title="Show/Hide Columns"
                            onClick={() => {
                              if (!open) {
                                setOpen(true);
                              }
                            }}
                          >
                            <OutlinedIcon name="playlist_add_check" />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td
                colSpan={columns.length}
                className="h-full"
                aria-live="polite"
              >
                {isLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <Spinner
                      size="large"
                      description="Loading..."
                    />
                  </div>
                ) : table.getFilteredRowModel().rows.length > 0 ? (
                  <p className="sr-only">{`${table.getFilteredRowModel().rows.length} results found`}</p>
                ) : (
                  <p className="text-center">No results found</p>
                )}
              </td>
            </tr>
          </tbody>
          {children && (
            <tfoot className="body-footer sticky bottom-0 z-20 px-0">
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-0"
                >
                  <div className="max-w-[calc(100vw-2px)]">{children}</div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <FullPageModal
        open={open}
        onClose={() => setOpen(false)}
        headerChildren={<h2 id="show-hide-columns-header">Show/Hide Columns</h2>}
        size="none"
        aria-labelledby="show-hide-columns-header"
      >
        <CheckboxWithLabel
          checked={table.getIsAllColumnsVisible()}
          onChange={(event) => table.toggleAllColumnsVisible(Boolean(event.target.checked))}
          label="Toggle All"
          containerClassName="px-global py-2 mb-2 border-b border-gray-200"
        />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <CheckboxWithLabel
              key={column.id}
              checked={column.getIsVisible()}
              onChange={(event) => column.toggleVisibility(Boolean(event.target.checked))}
              label={column.id}
              containerClassName="px-global pb-1"
            />
          ))}
      </FullPageModal>
    </div>
  );
}
