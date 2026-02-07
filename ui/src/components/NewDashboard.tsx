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

import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { PoolsFilter } from "~/components/PoolsFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";

import { InlineBanner } from "./InlineBanner";

interface NewDashboardProps {
  open: boolean;
  onClose: () => void;
  existingNames: string[];
  onCreate: (name: string, allPools: boolean, pools: string, userType: UserFilterType, selectedUsers: string) => void;
  currentUserName: string;
}

export default function NewDashboard({
  open,
  onClose,
  existingNames,
  onCreate,
  currentUserName,
}: NewDashboardProps) {
  const [name, setName] = useState("");
  const [allPools, setAllPools] = useState(false);
  const [localPools, setLocalPools] = useState("");
  const [userType, setUserType] = useState<UserFilterType>(UserFilterType.CURRENT);
  const [selectedUsers, setSelectedUsers] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setName("");
    setNameError(undefined);
    setAllPools(false);
    setLocalPools("");
    setUserType(UserFilterType.CURRENT);
    setSelectedUsers("");
  }, [open]);

  const handleClose = () => {
    onClose();
    setName("");
    setNameError(undefined);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    if (existingNames.includes(trimmedName)) {
      setNameError("Dashboard name already exists");
      return;
    }

    onCreate(trimmedName, allPools, localPools, userType, selectedUsers);
    setName("");
    setNameError(undefined);
    onClose();
  };

  return (
    <FullPageModal
      id="new-dashboard"
      open={open}
      onClose={handleClose}
      headerChildren="New Dashboard"
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-global p-global">
          <TextInput
            id="dashboard-name"
            label="Name"
            className="w-full"
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setName(event.target.value);
              setNameError(undefined);
            }}
            errorText={nameError}
            required
          />
          <PoolsFilter
            isSelectAllPoolsChecked={allPools}
            selectedPools={localPools}
            setIsSelectAllPoolsChecked={setAllPools}
            setSelectedPools={setLocalPools}
          />
          <UserFilter
            userType={userType}
            setUserType={setUserType}
            selectedUsers={selectedUsers}
            setSelectedUsers={setSelectedUsers}
            currentUserName={currentUserName}
          />
        </div>
        <InlineBanner status={nameError ? "error" : "none"}>{nameError}</InlineBanner>
        <div className="flex justify-end p-global bg-footerbg">
          <button
            className="btn btn-primary"
            type="submit"
          >
            <OutlinedIcon name="add" />
            Add
          </button>
        </div>
      </form>
    </FullPageModal>
  );
}
