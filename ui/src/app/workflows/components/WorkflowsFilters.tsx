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
import { PoolsFilter } from "~/components/PoolsFilter";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";
import { type PriorityType, WorkflowStatusValues, type WorkflowStatusType } from "~/models";

import { getMapFromStatusArray, getWorkflowStatusArray, StatusFilter } from "./StatusFilter";

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
  onSave: (props: WorkflowsFiltersDataProps) => void;
  onReset?: () => void;
  onDelete?: () => void;
  saveButtonText?: string;
  saveButtonIcon?: string;
  fields?: Fields[];
}

export const validateFilters = ({
  isSelectAllPoolsChecked,
  selectedPools,
  dateRange,
  submittedAfter,
  submittedBefore,
  statusFilterType,
  statuses,
}: WorkflowsFiltersDataProps): string[] => {
  const errors: string[] = [];
  if (!isSelectAllPoolsChecked && selectedPools.length === 0) {
    errors.push("Please select at least one pool");
  }
  if (dateRange === customDateRange && (submittedAfter === undefined || submittedBefore === undefined)) {
    errors.push("Please select a date range");
  }
  if (statusFilterType === StatusFilterType.CUSTOM && !statuses?.length) {
    errors.push("Please select at least one status");
  }
  return errors;
};

export type Fields = "name" | "date" | "status" | "pool" | "priority" | "user";

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
  onSave,
  onReset,
  onDelete,
  saveButtonText = "Refresh",
  saveButtonIcon = "refresh",
  fields = ["name", "date", "status", "pool", "priority"],
}: WorkflowsFiltersProps) => {
  const [localName, setLocalName] = useState<string>(name);
  const [localDateRange, setLocalDateRange] = useState(dateRange);
  const [localSubmittedAfter, setLocalSubmittedAfter] = useState<string | undefined>(submittedAfter);
  const [localSubmittedBefore, setLocalSubmittedBefore] = useState<string | undefined>(submittedBefore);
  const [localStatusFilterType, setLocalStatusFilterType] = useState<StatusFilterType | undefined>(statusFilterType);
  const [localStatusMap, setLocalStatusMap] = useState<Map<WorkflowStatusType, boolean>>(new Map());
  const [localPools, setLocalPools] = useState(selectedPools);
  const [localUsers, setLocalUsers] = useState<string>(selectedUsers);
  const [localUserType, setLocalUserType] = useState<UserFilterType>(userType);
  const [localAllPools, setLocalAllPools] = useState<boolean>(isSelectAllPoolsChecked);
  const [errors, setErrors] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<PriorityType | undefined>(priority);

  useEffect(() => {
    setPriorityFilter(priority);
  }, [priority]);

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
  }, [isSelectAllPoolsChecked]);

  useEffect(() => {
    setLocalPools(selectedPools);
  }, [selectedPools]);

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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = getWorkflowStatusArray(localStatusFilterType, localStatusMap);

    const data = {
      userType: localUserType,
      selectedUsers: localUsers,
      selectedPools: localPools,
      isSelectAllPoolsChecked: localAllPools,
      dateRange: localDateRange,
      submittedAfter: localSubmittedAfter,
      submittedBefore: localSubmittedBefore,
      name: localName,
      statusFilterType: localStatusFilterType,
      statuses: statuses.join(","),
      priority: priorityFilter,
    };
    const formErrors = validateFilters(data);

    setErrors(formErrors);

    if (formErrors.length > 0) {
      return;
    }

    onSave(data);
  };

  const handleReset = () => {
    setLocalName("");
    setLocalStatusFilterType(StatusFilterType.ALL);
    setLocalStatusMap(new Map(WorkflowStatusValues.map((value) => [value, true])));
    setLocalUserType(UserFilterType.CURRENT);
    setLocalUsers(currentUserName);
    setLocalAllPools(true);
    setLocalPools("");
    setErrors([]);
    setPriorityFilter(undefined);

    onReset?.();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-global flex flex-col gap-global">
        {fields.includes("user") && (
          <UserFilter
            userType={localUserType}
            setUserType={setLocalUserType}
            selectedUsers={localUsers}
            setSelectedUsers={setLocalUsers}
            currentUserName={currentUserName}
          />
        )}
        {fields.includes("name") && (
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
        )}
        {fields.includes("priority") && (
          <fieldset className="flex flex-col gap-1 mb-2">
            <legend>Priority</legend>
            <div className="flex flex-row flex-wrap gap-radios">
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
        )}
        {fields.includes("status") && (
          <StatusFilter
            statusMap={localStatusMap}
            setStatusMap={setLocalStatusMap}
            statusFilterType={localStatusFilterType}
            setStatusFilterType={setLocalStatusFilterType}
          />
        )}
        {fields.includes("pool") && (
            <PoolsFilter
            isSelectAllPoolsChecked={localAllPools}
            selectedPools={localPools}
            setIsSelectAllPoolsChecked={setLocalAllPools}
            setSelectedPools={setLocalPools}
          />
        )}
        {fields.includes("date") && (
          <DateRangePicker
            selectedRange={localDateRange}
            setSelectedRange={setLocalDateRange}
            fromDate={localSubmittedAfter}
            setFromDate={setLocalSubmittedAfter}
            toDate={localSubmittedBefore}
            setToDate={setLocalSubmittedBefore}
            className="flex flex-col gap-global mt-2"
          />
        )}
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
      <div className="flex flex-row gap-global justify-between body-footer p-global sm:sticky sm:bottom-0">
        {onReset && (
          <button
            type="button"
            className="btn"
            onClick={handleReset}
          >
            <OutlinedIcon name="undo" />
            Reset
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn"
            onClick={onDelete}
          >
            <OutlinedIcon name="delete" />
            Delete
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
        >
          <OutlinedIcon name={saveButtonIcon} />
          {saveButtonText}
        </button>
      </div>
    </form>
  );
};
