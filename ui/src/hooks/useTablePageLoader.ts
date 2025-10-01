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
import { useMemo } from "react";

import { useSearchParams } from "next/navigation";

import { TABLE_PAGE_SIZE_KEY } from "~/components/StoreProvider";

export const PARAM_KEYS = {
  pageSize: "pageSize",
  pageIndex: "pageIndex",
} as const;

const DEFAULT_PAGE_SIZE = 20;

interface PaginationState {
  pageIndex: number;
  pageSize: number;
  totalPageCount: number;
}

export const useTablePageLoader = (totalRows: number): PaginationState => {
  const params = useSearchParams();
  const pageSizeParam = params.get(PARAM_KEYS.pageSize);
  const pageIndexParam = params.get(PARAM_KEYS.pageIndex);

  return useMemo(() => {
    let pageSize = DEFAULT_PAGE_SIZE;
    let pageIndex = 0;
    const storedPageSize = localStorage.getItem(TABLE_PAGE_SIZE_KEY);

    try {
      if (pageSizeParam) {
        pageSize = parseInt(pageSizeParam);
      } else if (storedPageSize) {
        pageSize = parseInt(storedPageSize);
      }

      if (isNaN(pageSize)) {
        pageSize = DEFAULT_PAGE_SIZE;
      }
    } catch (error) {
      console.error("Error parsing page size", error);
      pageSize = DEFAULT_PAGE_SIZE;
    }

    try {
      if (pageIndexParam) {
        pageIndex = parseInt(pageIndexParam);
      }

      if (isNaN(pageIndex)) {
        pageIndex = 0;
      }
    } catch (error) {
      console.error("Error parsing page index", error);
      pageIndex = 0;
    }

    const totalPageCount = totalRows ? Math.ceil(totalRows / pageSize) : 0;

    if (pageIndex >= totalPageCount) {
      pageIndex = totalPageCount - 1;
    } else if (pageIndex < 0) {
      pageIndex = 0;
    }

    localStorage.setItem(TABLE_PAGE_SIZE_KEY, pageSize.toString());

    return { pageIndex, pageSize, totalPageCount };
  }, [totalRows, pageSizeParam, pageIndexParam]);
};
