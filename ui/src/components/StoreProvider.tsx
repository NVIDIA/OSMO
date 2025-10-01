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
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from "react";

const APP_NAME = "osmo-ui";

const SIDEBAR_KEY = `${APP_NAME}-kui-sidebar`;
export const SHOW_USED_KEY = `${APP_NAME}-show-used`;
export const RESOURCE_PINNED_KEY = `${APP_NAME}-resource-pinned`;
export const TASK_PINNED_KEY = `${APP_NAME}-task-pinned`;
export const POOL_PINNED_KEY = `${APP_NAME}-pool-pinned`;
export const WORKFLOW_PINNED_KEY = `${APP_NAME}-workflow-pinned`;
export const TABLE_PAGE_SIZE_KEY = `${APP_NAME}-table-page-size`;

export enum UrlTypes {
  Workflows = "WORKFLOWS",
  Datasets = "DATASETS",
  Resources = "RESOURCES",
  Tasks = "TASKS",
  TasksSummary = "TASKS_SUMMARY",
  Pools = "POOLS",
}

export type StoreContextProps = {
  // sidebar and breadcrumbs
  sidebarData: Map<UrlTypes, string>;
  handleChangeSidebarData: (urlType: UrlTypes, queryParams: string) => void;
};

export const StoreContext = createContext<StoreContextProps>({
  // sidebar and breadcrumbs
  sidebarData: new Map(),
  handleChangeSidebarData: () => null,
});

export const useStore = () => useContext(StoreContext);

export const StoreProvider = ({ children }: PropsWithChildren) => {
  const [_mounted, _setMounted] = useState(false);

  // Storing the context of the previous table state from inside the side-bar
  const [sidebarData, setSidebarData] = useState<StoreContextProps["sidebarData"]>(new Map());

  const handleChangeSidebarData: StoreContextProps["handleChangeSidebarData"] = (
    urlType: UrlTypes,
    queryParams: string,
  ) => {
    setSidebarData((map) => new Map(map.set(urlType, queryParams)));
  };

  useEffect(() => {
    _setMounted(true);

    if (typeof window !== "undefined") {
      const _sidebar = window.localStorage.getItem(SIDEBAR_KEY);

      if (_sidebar !== null) {
        const _sidebarData = JSON.parse(_sidebar) as [UrlTypes, string][];
        setSidebarData(new Map(_sidebarData));
      } else {
        setSidebarData(
          new Map([
            [UrlTypes.Workflows, ""],
            [UrlTypes.Datasets, ""],
            [UrlTypes.Resources, ""],
            [UrlTypes.Tasks, ""],
          ]),
        );
      }
    }
  }, []);

  useEffect(() => {
    if (sidebarData.size > 0 && typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify(Array.from(sidebarData.entries())));
    }
  }, [sidebarData]);

  return (
    <StoreContext.Provider
      value={{
        sidebarData,
        handleChangeSidebarData,
      }}
    >
      {_mounted && children}
    </StoreContext.Provider>
  );
};
