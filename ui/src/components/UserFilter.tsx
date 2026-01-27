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

import { api } from "~/trpc/react";

import { Multiselect } from "./Multiselect";

export enum UserFilterType {
  ALL = "all",
  CURRENT = "current",
  CUSTOM = "custom",
}

export interface UserFilterProps {
  userType: UserFilterType;
  setUserType: (userType: UserFilterType) => void;
  selectedUsers: string;
  setSelectedUsers: (selectedUsers: string) => void;
  currentUserName: string;
}

export const UserFilter = ({
  userType,
  setUserType,
  selectedUsers,
  setSelectedUsers,
  currentUserName,
}: UserFilterProps) => {
  const [userFilter, setUserFilter] = useState<Map<string, boolean> | undefined>(undefined);

  const users = api.users.getList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const filters = new Map<string, boolean>(Array.from(users.data ?? []).map((user) => [user, false]));

    selectedUsers.split(",").forEach((user) => {
      if (user.length > 0) {
        filters.set(user, true);
      }
    });

    setUserFilter(filters);
  }, [selectedUsers, users.data]);

  useEffect(() => {
    if (userType === UserFilterType.CUSTOM && userFilter) {
      setSelectedUsers(
        Array.from(userFilter.entries())
          .filter(([_, enabled]) => enabled)
          .map(([user]) => user)
          .join(","),
      );
    } else if (userType === UserFilterType.CURRENT) {
      setSelectedUsers(currentUserName);
    } else if (userType === UserFilterType.ALL) {
      setSelectedUsers("");
    }
  }, [userFilter, setSelectedUsers, userType, currentUserName]);

  return (
    <>
      <fieldset className="flex flex-col gap-1 mb-2">
        <legend>Users</legend>
        <div className="flex flex-row gap-7">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="userFilter"
              value={UserFilterType.ALL}
              checked={userType === UserFilterType.ALL}
              onChange={() => setUserType(UserFilterType.ALL)}
            />
            All
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="userFilter"
              value={UserFilterType.CURRENT}
              checked={userType === UserFilterType.CURRENT}
              onChange={() => {
                setUserType(UserFilterType.CURRENT);
                setSelectedUsers(currentUserName);
              }}
            />
            Current User
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="userFilter"
              value={UserFilterType.CUSTOM}
              checked={userType === UserFilterType.CUSTOM}
              onChange={() => setUserType(UserFilterType.CUSTOM)}
            />
            Custom
          </label>
        </div>
      </fieldset>
      {userType === UserFilterType.CUSTOM && userFilter && (
        <Multiselect
          id="users"
          placeholder="Filter by user name..."
          aria-label="Filter by user name"
          filter={userFilter}
          setFilter={setUserFilter}
        />
      )}
    </>
  );
};
