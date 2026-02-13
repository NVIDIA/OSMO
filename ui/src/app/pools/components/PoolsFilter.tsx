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

import { OutlinedIcon } from "~/components/Icon";
import { PoolsFilter } from "~/components/PoolsFilter";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export const PoolsPageFilter = ({
  isSelectAllPoolsChecked,
  selectedPools,
  updateUrl,
  onRefresh,
}: {
  isSelectAllPoolsChecked: boolean;
  selectedPools: string;
  updateUrl: (props: ToolParamUpdaterProps) => void;
  onRefresh: () => void;
}) => {
  const [localPools, setLocalPools] = useState(selectedPools);
  const [localAllPools, setLocalAllPools] = useState(isSelectAllPoolsChecked);

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
  }, [isSelectAllPoolsChecked]);

  useEffect(() => {
    setLocalPools(selectedPools);
  }, [selectedPools]);

  const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    updateUrl({
      pools: localPools,
      allPools: localAllPools,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-global">
        <PoolsFilter
          isSelectAllPoolsChecked={localAllPools}
          selectedPools={localPools}
          setIsSelectAllPoolsChecked={setLocalAllPools}
          setSelectedPools={setLocalPools}
        />
      </div>
      <div className="flex flex-row gap-global justify-between body-footer p-global">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLocalPools("");
            setLocalAllPools(true);
            updateUrl({
              pools: "",
              allPools: true,
            });
          }}
        >
          <OutlinedIcon name="undo" />
          Reset
        </button>
        <button
          type="submit"
          className="btn btn-primary"
        >
          <OutlinedIcon name="refresh" />
          Refresh
        </button>
      </div>
    </form>
  );
};
