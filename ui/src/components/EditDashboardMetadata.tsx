//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";

import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { PoolsFilter } from "~/components/PoolsFilter";
import { Switch } from "~/components/Switch";
import { TextInput } from "~/components/TextInput";

import type { Dashboard } from "../app/page";

interface EditDashboardMetadataModalProps {
  open: boolean;
  onClose: () => void;
  dashboard?: Dashboard;
  defaultDashboardID: string;
  onSave: (name: string, isDefault: boolean, allPools: boolean, pools: string) => void;
}

const EditDashboardMetadata = ({
  open,
  onClose,
  dashboard,
  defaultDashboardID,
  onSave,
}: EditDashboardMetadataModalProps) => {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [allPools, setAllPools] = useState(false);
  const [localPools, setLocalPools] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(dashboard?.name ?? "");
    setIsDefault(dashboard?.id === defaultDashboardID);
    setAllPools(dashboard?.allPools ?? false);
    setLocalPools(dashboard?.pools.join(",") ?? "");
  }, [dashboard, defaultDashboardID, open]);

  return (
    <FullPageModal
      open={open}
      onClose={onClose}
      headerChildren="Edit Dashboard"
      size="sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            name,
            isDefault,
            allPools,
            localPools,
          );
        }}
      >
        <div className="flex flex-col gap-global p-global">
          <TextInput
            id="dashboard-name"
            label="Name"
            className="w-full"
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setName(event.target.value);
            }}
            required
          />
          <Switch
            id="is-default"
            label="Default Dashboard"
            checked={isDefault}
            onChange={(checked) => {
              setIsDefault(checked);
            }}
            size="small"
            labelPosition="right"
          />
          <PoolsFilter
            isSelectAllPoolsChecked={allPools}
            selectedPools={localPools}
            setIsSelectAllPoolsChecked={setAllPools}
            setSelectedPools={setLocalPools}
          />
        </div>
        <div className="flex justify-end p-global bg-footerbg">
          <button
            className="btn btn-primary"
            type="submit"
          >
            <OutlinedIcon name="save" />
            Save
          </button>
        </div>
      </form>
    </FullPageModal>
  );
};

export default EditDashboardMetadata;
