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
import { usePathname, useRouter } from "next/navigation";

import { type UrlTypes, useStore } from "~/components/StoreProvider";
import { PARAM_KEYS as TABLE_PARAM_KEYS } from "~/hooks/useTablePageLoader";
import { PARAM_KEYS as SORT_PARAM_KEYS } from "~/hooks/useTableSortLoader";
import { type DatasetTypesSchema } from "~/models";

export const PARAM_KEYS = {
  name: "name",
  allUsers: "allUsers",
  users: "users",
  buckets: "buckets",
  dateRange: "dateRange",
  createdAfter: "createdAfter",
  createdBefore: "createdBefore",
  datasetType: "datasetType",
} as const;

interface ToolParamUpdaterProps {
  name?: string | null;
  pageSize?: number;
  pageIndex?: number;
  buckets?: string[] | null;
  users?: string[] | null;
  dateRange?: number | null;
  createdAfter?: string | null;
  createdBefore?: string | null;
  allUsers?: boolean;
  datasetType?: DatasetTypesSchema | null;
}

// Undefined means no change; null means clear
const useToolParamUpdater = (urlType?: UrlTypes) => {
  const pathname = usePathname();
  const router = useRouter();
  const { handleChangeSidebarData } = useStore();

  const updateUrl = (props: ToolParamUpdaterProps): void => {
    const {
      name,
      buckets,
      users,
      dateRange,
      createdAfter,
      createdBefore,
      allUsers,
      datasetType,
    } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (name === null) {
      newParams.delete(PARAM_KEYS.name);
    } else if (name !== undefined) {
      newParams.set(PARAM_KEYS.name, name);
    }

    if (allUsers !== undefined) {
      newParams.set(PARAM_KEYS.allUsers, allUsers.toString());
    }

    if (buckets === null) {
      newParams.delete(PARAM_KEYS.buckets);
    } else if (buckets !== undefined) {
      newParams.set(PARAM_KEYS.buckets, buckets.join(","));
    }

    if (users === null) {
      newParams.delete(PARAM_KEYS.users);
    } else if (users !== undefined) {
      newParams.set(PARAM_KEYS.users, users.join(","));
    }

    if (dateRange === null) {
      newParams.delete(PARAM_KEYS.dateRange);
    } else if (dateRange !== undefined) {
      newParams.set(PARAM_KEYS.dateRange, dateRange.toString());
    }

    if (createdAfter === null) {
      newParams.delete(PARAM_KEYS.createdAfter);
    } else if (createdAfter !== undefined) {
      newParams.set(PARAM_KEYS.createdAfter, createdAfter);
    }

    if (createdBefore === null) {
      newParams.delete(PARAM_KEYS.createdBefore);
    } else if (createdBefore !== undefined) {
      newParams.set(PARAM_KEYS.createdBefore, createdBefore);
    }

    if (datasetType === null) {
      newParams.delete(PARAM_KEYS.datasetType);
    } else if (datasetType !== undefined) {
      newParams.set(PARAM_KEYS.datasetType, datasetType.toString());
    }

    router.replace(`${pathname}?${newParams.toString()}`);

    if (urlType) {
      // Remove specific params from the sidebar data
      newParams.delete(TABLE_PARAM_KEYS.pageSize);
      newParams.delete(TABLE_PARAM_KEYS.pageIndex);
      newParams.delete(SORT_PARAM_KEYS.sorting);
      handleChangeSidebarData(urlType, `?${newParams.toString()}`);
    }
  };

  return updateUrl;
};

export default useToolParamUpdater;
