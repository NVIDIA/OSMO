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

import { customDateRange, DateRangePicker, defaultDateRange } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Multiselect } from "~/components/Multiselect";
import { UrlTypes } from "~/components/StoreProvider";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";
import { DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import useToolParamUpdater from "../hooks/useToolParamUpdater";

export interface DatasetsFilterDataProps {
  userType: UserFilterType;
  selectedUsers: string;
  selectedBuckets: string;
  dateRange: number;
  createdAfter?: string;
  createdBefore?: string;
  name: string;
}

interface DatasetsFilterProps extends DatasetsFilterDataProps {
  datasetsType?: DatasetTypesSchema;
  currentUserName: string;
  onRefresh: () => void;
  validateFilters: (props: DatasetsFilterDataProps) => string[];
}

export const DatasetsFilter = ({
  userType,
  selectedUsers,
  selectedBuckets,
  dateRange,
  createdAfter,
  createdBefore,
  name,
  currentUserName,
  datasetsType,
  onRefresh,
  validateFilters,
}: DatasetsFilterProps) => {
  const toolParamUpdater = useToolParamUpdater(UrlTypes.Datasets);
  const [localName, setLocalName] = useState<string>(name);
  const [localDateRange, setLocalDateRange] = useState(dateRange);
  const [localCreatedAfter, setLocalCreatedAfter] = useState<string | undefined>(undefined);
  const [localCreatedBefore, setLocalCreatedBefore] = useState<string | undefined>(undefined);
  const [localBuckets, setLocalBuckets] = useState<Map<string, boolean>>(new Map());
  const [localUserType, setLocalUserType] = useState(userType);
  const [localSelectedUsers, setLocalSelectedUsers] = useState<string>(selectedUsers);
  const [localDatasetType, setLocalDatasetType] = useState<DatasetTypesSchema | undefined>(datasetsType);
  const [errors, setErrors] = useState<string[]>([]);
  const { data: allBucketNames } = api.datasets.getBucketInfo.useQuery(
    {},
    {
      staleTime: Infinity,
      select: (data) => Object.keys(data ?? {}),
      initialData: [],
    },
  );

  useEffect(() => {
    setLocalUserType(userType);
  }, [userType]);

  useEffect(() => {
    setLocalName(name);
    setLocalDateRange(dateRange);
    setLocalCreatedAfter(createdAfter);
    setLocalCreatedBefore(createdBefore);
  }, [name, dateRange, createdAfter, createdBefore]);

  useEffect(() => {
    const filters = new Map<string, boolean>(allBucketNames?.map((bucket) => [bucket, false]) ?? []);

    if (selectedBuckets.length) {
      selectedBuckets.split(",").forEach((bucket) => {
        filters.set(bucket, true);
      });
    }

    setLocalBuckets(filters);
  }, [allBucketNames, selectedBuckets]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const buckets = Array.from(localBuckets.entries())
      .filter(([_, enabled]) => enabled)
      .map(([bucket]) => bucket);

    const errors = validateFilters({
      userType: localUserType,
      selectedUsers: localSelectedUsers,
      selectedBuckets: buckets.join(","),
      dateRange: localDateRange,
      createdAfter: localCreatedAfter,
      createdBefore: localCreatedBefore,
      name: localName,
    });
    setErrors(errors);

    if (errors.length > 0) {
      return;
    }

    toolParamUpdater({
      name: localName,
      dateRange: localDateRange,
      createdAfter: localDateRange === customDateRange ? localCreatedAfter : null,
      createdBefore: localDateRange === customDateRange ? localCreatedBefore : null,
      allUsers: localUserType === UserFilterType.ALL,
      users: localUserType === UserFilterType.ALL ? null : localSelectedUsers.split(","),
      buckets: buckets,
      datasetType: localDatasetType ?? null,
    });

    onRefresh();
  };

  const handleReset = () => {
    setLocalName("");
    setLocalBuckets(new Map(allBucketNames.map((bucket) => [bucket, true])));
    setLocalSelectedUsers(currentUserName);
    setLocalDateRange(defaultDateRange);
    setLocalUserType(UserFilterType.ALL);
    setLocalDatasetType(undefined);

    toolParamUpdater({
      name: null,
      dateRange: defaultDateRange,
      createdAfter: null,
      createdBefore: null,
      allUsers: true,
      users: [currentUserName],
      buckets: allBucketNames,
      datasetType: null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3 p-3">
        <UserFilter
          userType={localUserType}
          setUserType={setLocalUserType}
          selectedUsers={localSelectedUsers}
          setSelectedUsers={setLocalSelectedUsers}
          currentUserName={currentUserName}
        />
        <fieldset className="flex flex-col gap-1 mb-2">
          <legend>Type</legend>
          <div className="flex flex-row gap-7">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="datasetType"
                value="ALL"
                checked={localDatasetType === undefined}
                onChange={() => setLocalDatasetType(undefined)}
              />
              All
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="datasetType"
                value={DatasetTypesSchema.Dataset}
                checked={localDatasetType === DatasetTypesSchema.Dataset}
                onChange={() => setLocalDatasetType(DatasetTypesSchema.Dataset)}
              />
              Dataset
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="datasetType"
                value={DatasetTypesSchema.Collection}
                checked={localDatasetType === DatasetTypesSchema.Collection}
                onChange={() => setLocalDatasetType(DatasetTypesSchema.Collection)}
              />
              Collection
            </label>
          </div>
        </fieldset>
        <TextInput
          id="name"
          label="Name"
          placeholder={`Filter by name...`}
          value={localName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalName(e.target.value)}
          className="w-full"
        />
        <div>
          <label htmlFor="buckets-search">Buckets</label>
          <Multiselect
            id="buckets"
            placeholder="Filter by bucket name..."
            aria-label="Filter by bucket name"
            filter={localBuckets}
            setFilter={setLocalBuckets}
          />
        </div>
        <DateRangePicker
          selectedRange={localDateRange}
          setSelectedRange={setLocalDateRange}
          fromDate={localCreatedAfter}
          toDate={localCreatedBefore}
          setFromDate={setLocalCreatedAfter}
          setToDate={setLocalCreatedBefore}
          className="flex flex-col gap-3 mt-2"
        />
        {errors.length > 0 && (
          <InlineBanner status="error">
            <div className="flex flex-col gap-2">
              {errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          </InlineBanner>
        )}
      </div>
      <div className="flex flex-row gap-3 justify-between body-footer p-3 sticky bottom-0">
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
