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

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SHOW_USED_KEY, UrlTypes, useStore } from "~/components/StoreProvider";
import { PARAM_KEYS as TABLE_PARAM_KEYS } from "~/hooks/useTablePageLoader";
import { PARAM_KEYS as SORT_PARAM_KEYS } from "~/hooks/useTableSortLoader";

const PARAM_KEYS = {
  pools: "pools",
  allPools: "allPools",
  isShowingUsed: "isShowingUsed",
} as const;

export interface ToolParamUpdaterProps {
  pools?: string;
  allPools?: boolean;
  isShowingUsed?: boolean;
}

// Undefined means no change; null means clear
const useToolParamUpdater = (urlType: UrlTypes = UrlTypes.Resources) => {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { handleChangeSidebarData } = useStore();
  const [isSelectAllPoolsChecked, setIsSelectAllPoolsChecked] = useState(true);
  const [selectedPools, setSelectedPools] = useState("");
  const [filterCount, setFilterCount] = useState(0);
  const [isShowingUsed, setIsShowingUsed] = useState(false);

  useEffect(() => {
    let filterCount = 0;

    setSelectedPools(params.get(PARAM_KEYS.pools) ?? "");

    const showUsedParam = params.get(PARAM_KEYS.isShowingUsed);
    if (showUsedParam !== null) {
      setIsShowingUsed(showUsedParam === "true");
    } else {
      const storedShowUsed = localStorage.getItem(SHOW_USED_KEY);
      if (storedShowUsed !== null) {
        setIsShowingUsed(storedShowUsed === "true");
      }
    }

    const allPools = params.get(PARAM_KEYS.allPools) !== "false";
    setIsSelectAllPoolsChecked(allPools);
    if (!allPools) {
      filterCount++;
    }

    setFilterCount(filterCount);
  }, [params, urlType]);

  const updateUrl = (props: ToolParamUpdaterProps): void => {
    const { pools, allPools, isShowingUsed } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (pools !== undefined) {
      newParams.set(PARAM_KEYS.pools, pools);
    }

    if (allPools !== undefined) {
      newParams.set(PARAM_KEYS.allPools, allPools.toString());
    }

    if (isShowingUsed !== undefined) {
      newParams.set(PARAM_KEYS.isShowingUsed, isShowingUsed.toString());
    } else if (isShowingUsed === null) {
      newParams.delete(PARAM_KEYS.isShowingUsed);
    }

    router.replace(`${pathname}?${newParams.toString()}`);

    // Remove the selected resource from the sidebar data
    newParams.delete(TABLE_PARAM_KEYS.pageSize);
    newParams.delete(TABLE_PARAM_KEYS.pageIndex);
    newParams.delete(SORT_PARAM_KEYS.sorting);
    handleChangeSidebarData(urlType, `?${newParams.toString()}`);
  };

  return {
    updateUrl,
    isSelectAllPoolsChecked,
    selectedPools,
    filterCount,
    isShowingUsed,
  };
};

export default useToolParamUpdater;
