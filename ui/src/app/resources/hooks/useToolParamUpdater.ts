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

import { type NodePoolAndPlatform } from "../components/ResourceDetails";

const PARAM_KEYS = {
  nodes: "nodes",
  allNodes: "allNodes",
  pools: "pools",
  allPools: "allPools",
  resourceType: "resourceType",
  isShowingUsed: "isShowingUsed",
  showDetails: "showDetails",
  selectedResource: "selectedResource",
} as const;

export interface ToolParamUpdaterProps {
  nodes?: string;
  allNodes?: boolean;
  pools?: string;
  allPools?: boolean;
  resourceType?: string | null;
  isShowingUsed?: boolean;
  showDetails?: boolean;
  selectedResource?: NodePoolAndPlatform | null;
}

// Undefined means no change; null means clear
const useToolParamUpdater = (urlType: UrlTypes = UrlTypes.Resources) => {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { handleChangeSidebarData } = useStore();
  const [isSelectAllPoolsChecked, setIsSelectAllPoolsChecked] = useState(true);
  const [isSelectAllNodesChecked, setIsSelectAllNodesChecked] = useState(true);
  const [selectedPools, setSelectedPools] = useState("");
  const [nodes, setNodes] = useState("");
  const [filterCount, setFilterCount] = useState(0);
  const [filterResourceTypes, setFilterResourceTypes] = useState<string | undefined>(undefined);
  const [selectedResource, setSelectedResource] = useState<NodePoolAndPlatform | undefined>(undefined);
  const [isShowingUsed, setIsShowingUsed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

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

    setShowDetails(params.get(PARAM_KEYS.showDetails) === "true");

    const resourceType = params.get(PARAM_KEYS.resourceType);
    setFilterResourceTypes(resourceType ?? undefined);
    if (resourceType) {
      filterCount++;
    }

    const allPools = params.get(PARAM_KEYS.allPools) !== "false";
    setIsSelectAllPoolsChecked(allPools);
    if (!allPools) {
      filterCount++;
    }

    const allNodes = params.get(PARAM_KEYS.allNodes) !== "false";
    setIsSelectAllNodesChecked(allNodes);
    if (!allNodes) {
      filterCount++;
    }

    const nodes = params.get(PARAM_KEYS.nodes);
    setNodes(nodes ?? "");
    if (nodes) {
      filterCount++;
    }

    const selectedResource = params.get(PARAM_KEYS.selectedResource);
    if (selectedResource) {
      const [node, pool, platform] = selectedResource.split("/");
      if (node && pool && platform) {
        setSelectedResource({ node, pool, platform });
      } else {
        setSelectedResource(undefined);
      }
    } else {
      setSelectedResource(undefined);
    }

    setFilterCount(filterCount);
  }, [params, urlType]);

  const updateUrl = (props: ToolParamUpdaterProps): void => {
    const { nodes, allNodes, pools, allPools, resourceType, isShowingUsed, showDetails, selectedResource } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (allNodes !== undefined) {
      newParams.set(PARAM_KEYS.allNodes, allNodes.toString());
    }

    if (nodes !== undefined) {
      newParams.set(PARAM_KEYS.nodes, nodes);
    }

    if (pools !== undefined) {
      newParams.set(PARAM_KEYS.pools, pools);
    }

    if (allPools !== undefined) {
      newParams.set(PARAM_KEYS.allPools, allPools.toString());
    }

    if (resourceType === null) {
      newParams.delete(PARAM_KEYS.resourceType);
    } else if (resourceType) {
      newParams.set(PARAM_KEYS.resourceType, resourceType);
    }

    if (isShowingUsed !== undefined) {
      newParams.set(PARAM_KEYS.isShowingUsed, isShowingUsed.toString());
    } else if (isShowingUsed === null) {
      newParams.delete(PARAM_KEYS.isShowingUsed);
    }

    if (showDetails !== undefined) {
      newParams.set(PARAM_KEYS.showDetails, showDetails.toString());
    }

    if (selectedResource) {
      newParams.set(
        PARAM_KEYS.selectedResource,
        `${selectedResource.node}/${selectedResource.pool}/${selectedResource.platform}`,
      );
    } else if (selectedResource === null) {
      newParams.delete(PARAM_KEYS.selectedResource);
    }

    router.replace(`${pathname}?${newParams.toString()}`);

    // Remove the selected resource from the sidebar data
    newParams.delete(PARAM_KEYS.selectedResource);
    newParams.delete(TABLE_PARAM_KEYS.pageSize);
    newParams.delete(TABLE_PARAM_KEYS.pageIndex);
    newParams.delete(SORT_PARAM_KEYS.sorting);
    handleChangeSidebarData(urlType, `?${newParams.toString()}`);
  };

  return {
    updateUrl,
    isSelectAllPoolsChecked,
    isSelectAllNodesChecked,
    selectedPools,
    nodes,
    filterCount,
    filterResourceTypes,
    isShowingUsed,
    showDetails,
    selectedResource,
  };
};

export default useToolParamUpdater;
