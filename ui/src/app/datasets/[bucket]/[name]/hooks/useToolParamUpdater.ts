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

export enum ToolType {
  Labels = "labels",
  Tags = "tags",
  Metadata = "metadata",
  Collections = "collections",
  Delete = "delete",
  Rename = "rename",
}

export const PARAM_KEYS = {
  version: "version",
  tool: "tool",
  showVersions: "showVersions",
} as const;

interface ToolParamUpdaterProps {
  version?: string | null;
  tool?: ToolType | null;
  showVersions?: boolean | null;
}

// Undefined means no change; null means clear
export const useToolParamUpdater = (urlType?: UrlTypes) => {
  const pathname = usePathname();
  const router = useRouter();
  const { handleChangeSidebarData } = useStore();

  const updateUrl = (props: ToolParamUpdaterProps): void => {
    const {
      version,
      tool,
      showVersions,
    } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (version === null) {
      newParams.delete(PARAM_KEYS.version);
    } else if (version !== undefined) {
      newParams.set(PARAM_KEYS.version, version);
    }

    if (showVersions === null) {
      newParams.delete(PARAM_KEYS.showVersions);
    } else if (showVersions !== undefined) {
      newParams.set(PARAM_KEYS.showVersions, showVersions.toString());
    }

    if (tool) {
      newParams.set(PARAM_KEYS.tool, tool);
    } else if (tool === null) {
      newParams.delete(PARAM_KEYS.tool);
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
