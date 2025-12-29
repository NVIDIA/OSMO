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

import { customDateRange, DateRangePicker } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";
import { PoolsListResponseSchema, type PriorityType, WorkflowStatusValues, type WorkflowStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getMapFromStatusArray, getWorkflowStatusArray, StatusFilter } from "./StatusFilter";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export interface WorkflowsFiltersDataProps {
  userType: UserFilterType;
  selectedUsers: string;
  dateRange: number;
  submittedAfter?: string;
  submittedBefore?: string;
  statusFilterType?: StatusFilterType;
  statuses?: string;
  selectedPools: string;
  isSelectAllPoolsChecked: boolean;
  name: string;
  priority?: PriorityType;
}

interface WorkflowsFiltersProps extends WorkflowsFiltersDataProps {
  currentUserName: string;
  onRefresh: () => void;
  validateFilters: (props: WorkflowsFiltersDataProps) => string[];
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

export const WorkflowsFilters = ({
  userType,
  selectedUsers,
  dateRange,
  submittedAfter,
  submittedBefore,
  statusFilterType,
  statuses,
  selectedPools,
  isSelectAllPoolsChecked,
  name,
  priority,
  currentUserName,
  onRefresh,
  validateFilters,
  updateUrl,
}: WorkflowsFiltersProps) => {
  const [localName, setLocalName] = useState<string>(name);
  const [localDateRange, setLocalDateRange] = useState(dateRange);
  const [localSubmittedAfter, setLocalSubmittedAfter] = useState<string | undefined>(submittedAfter);
  const [localSubmittedBefore, setLocalSubmittedBefore] = useState<string | undefined>(submittedBefore);
  const [localStatusFilterType, setLocalStatusFilterType] = useState<StatusFilterType | undefined>(statusFilterType);
  const [localStatusMap, setLocalStatusMap] = useState<Map<WorkflowStatusType, boolean>>(new Map());
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [localUsers, setLocalUsers] = useState<string>(selectedUsers);
  const [localUserType, setLocalUserType] = useState<UserFilterType>(userType);
  const [allPools, setAllPools] = useState<boolean>(isSelectAllPoolsChecked);
  const [errors, setErrors] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<PriorityType | undefined>(priority);

  const pools = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setAllPools(isSelectAllPoolsChecked);
  }, [isSelectAllPoolsChecked]);

  useEffect(() => {
    setLocalUserType(userType);
  }, [userType]);

  useEffect(() => {
    setLocalUsers(selectedUsers);
  }, [selectedUsers]);

  useEffect(() => {
    setLocalStatusFilterType(statusFilterType);

    if (statusFilterType === StatusFilterType.CUSTOM) {
      const statusArray = statuses?.split(",") ?? [];
      setLocalStatusMap(getMapFromStatusArray(statusArray));
    } else {
      setLocalStatusMap(getMapFromStatusArray(getWorkflowStatusArray(statusFilterType)));
    }
  }, [statuses, statusFilterType]);

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  useEffect(() => {
    setLocalDateRange(dateRange);
  }, [dateRange]);

  useEffect(() => {
    const parsedData = PoolsListResponseSchema.safeParse(pools.data);
    const availablePools = parsedData.success ? parsedData.data.pools : [];

    const filters = new Map<string, boolean>(Object.keys(availablePools).map((pool) => [pool, false]));

    if (selectedPools.length) {
      selectedPools.split(",").forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [pools.data, selectedPools]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = getWorkflowStatusArray(localStatusFilterType, localStatusMap);

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([pool]) => pool);

    const formErrors = validateFilters({
      userType: localUserType,
      selectedUsers: localUsers,
      selectedPools: pools.join(","),
      isSelectAllPoolsChecked: allPools,
      dateRange: localDateRange,
      submittedAfter: localSubmittedAfter,
      submittedBefore: localSubmittedBefore,
      name: localName,
      statusFilterType: localStatusFilterType,
      statuses: statuses.join(","),
    });

    setErrors(formErrors);

    if (formErrors.length > 0) {
      return;
    }

    updateUrl({
      filterName: localName,
      dateRange: localDateRange,
      dateAfter: localDateRange === customDateRange ? localSubmittedAfter : null,
      dateBefore: localDateRange === customDateRange ? localSubmittedBefore : null,
      statusFilterType: localStatusFilterType,
      status: localStatusFilterType === StatusFilterType.CUSTOM ? statuses.join(",") : null,
      allPools,
      pools: allPools ? null : pools,
      allUsers: localUserType === UserFilterType.ALL,
      users: localUserType === UserFilterType.ALL ? null : localUsers.split(","),
      priority: priorityFilter ?? null,
    });

    onRefresh();
  };

  const handleReset = () => {
    setLocalName("");
    setLocalStatusFilterType(StatusFilterType.ALL);
    setLocalStatusMap(new Map(WorkflowStatusValues.map((value) => [value, true])));
    setLocalUserType(UserFilterType.CURRENT);
    setLocalUsers(currentUserName);
    setAllPools(true);
    setLocalPools(new Map());
    setErrors([]);
    setPriorityFilter(undefined);

    updateUrl({
      filterName: null,
      statusFilterType: StatusFilterType.ALL,
      status: null,
      allPools: true,
      allUsers: false,
      users: [currentUserName],
      dateRange: null,
      dateAfter: null,
      dateBefore: null,
      priority: null,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="body-component p-global flex flex-col gap-global">
        <UserFilter
          userType={localUserType}
          setUserType={setLocalUserType}
          selectedUsers={localUsers}
          setSelectedUsers={setLocalUsers}
          currentUserName={currentUserName}
        />
        <TextInput
          id="search-text"
          label="Workflow Name"
          placeholder="Filter by workflow name..."
          className="w-full"
          containerClassName="w-full mb-2"
          value={localName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setLocalName(event.target.value);
          }}
          slotLeft={<OutlinedIcon name="search" />}
          autoComplete="off"
        />
        <fieldset className="flex flex-col gap-1 mb-2">
          <legend>Priority</legend>
          <div className="flex flex-row gap-7">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value=""
                checked={priorityFilter === undefined}
                onChange={() => setPriorityFilter(undefined)}
              />
              All
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"HIGH"}
                checked={priorityFilter === "HIGH"}
                onChange={() => setPriorityFilter("HIGH")}
              />
              HIGH
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"NORMAL"}
                checked={priorityFilter === "NORMAL"}
                onChange={() => setPriorityFilter("NORMAL")}
              />
              NORMAL
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"LOW"}
                checked={priorityFilter === "LOW"}
                onChange={() => setPriorityFilter("LOW")}
              />
              LOW
            </label>
          </div>
        </fieldset>
        <StatusFilter
          statusMap={localStatusMap}
          setStatusMap={setLocalStatusMap}
          statusFilterType={localStatusFilterType}
          setStatusFilterType={setLocalStatusFilterType}
        />
        <MultiselectWithAll
          id="pools"
          label="All Pools"
          placeholder="Filter by pool name..."
          aria-label="Filter by pool name"
          filter={localPools}
          setFilter={setLocalPools}
          onSelectAll={setAllPools}
          isSelectAllChecked={allPools}
          showAll
        />
        <DateRangePicker
          selectedRange={localDateRange}
          setSelectedRange={setLocalDateRange}
          fromDate={localSubmittedAfter}
          setFromDate={setLocalSubmittedAfter}
          toDate={localSubmittedBefore}
          setToDate={setLocalSubmittedBefore}
          className="flex flex-col gap-global mt-2"
        />
        {errors.length > 0 && (
          <InlineBanner status="error">
            <div className="flex flex-col gap-global">
              {errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          </InlineBanner>
        )}
      </div>
      <div className="flex flex-row gap-global justify-between body-footer p-global sticky bottom-0">
        <button
          type="button"
          className="btn"
          onClick={handleReset}
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
