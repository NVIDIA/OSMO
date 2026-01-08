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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import { useAuth } from "~/components/AuthProvider";
import {
  customDateRange,
  type DateRange,
  defaultDateRange,
  getBestDateRange,
  getDateFromValues,
} from "~/components/DateRangePicker";
import { FilterButton } from "~/components/FilterButton";
import FullPageModal from "~/components/FullPageModal";
import { IconButton } from "~/components/IconButton";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { UserFilterType } from "~/components/UserFilter";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type DataListEntry, type DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import { CreateCollection, type DatasetInfo } from "./CreateCollection";
import { DatasetsFilter, type DatasetsFilterDataProps } from "./DatasetsFilter";
import DatasetsTable from "./DatasetsTable";
import { PARAM_KEYS } from "../hooks/useToolParamUpdater";

export interface SelectedDatasets {
  datasets: DatasetInfo[];
  bucket?: string;
}

export default function Datasets() {
  const { username } = useAuth();
  const [showFilters, setShowFilters] = useState(false);
  const [filterCount, setFilterCount] = useState(0);
  const [name, setName] = useState<string | undefined>(undefined);
  const [bucketFilter, setBucketFilter] = useState<string | undefined>(undefined);
  const [userFilter, setUserFilter] = useState<string>(username);
  const [datasetType, setDatasetType] = useState<DatasetTypesSchema | undefined>(undefined);
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [dateRangeDates, setDateRangeDates] = useState<DateRange | undefined>(undefined);
  const [createdAfter, setCreatedAfter] = useState<string | undefined>(undefined);
  const [createdBefore, setCreatedBefore] = useState<string | undefined>(undefined);
  const [isSelectAllUsersChecked, setIsSelectAllUsersChecked] = useState(false);
  const [selectedRows, setSelectedRows] = useState<SelectedDatasets>({ datasets: [] });
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [userType, setUserType] = useState<UserFilterType>(UserFilterType.ALL);
  const params = useSearchParams();
  const lastFetchTimeRef = useRef<number>(Date.now());
  const { setSafeTimeout } = useSafeTimeout();
  const { data: allBucketNames } = api.datasets.getBucketInfo.useQuery(
    {},
    {
      staleTime: Infinity,
      select: (data) => Object.keys(data ?? {}),
    },
  );

  const {
    data: datasets,
    isSuccess,
    isLoading,
    refetch,
  } = api.datasets.getDatasetList.useQuery(
    {
      all_users: isSelectAllUsersChecked,
      users: isSelectAllUsersChecked ? [] : userFilter.split(","),
      buckets: bucketFilter?.split(","),
      name: name,
      dataset_type: datasetType,
      latest_after: dateRangeDates?.fromDate?.toISOString() ?? undefined,
      latest_before: dateRangeDates?.toDate?.toISOString() ?? undefined,
    },
    {
      refetchOnWindowFocus: false,
      onSuccess: () => {
        lastFetchTimeRef.current = Date.now();
      },
    },
  );

  const processResources = useMemo((): DataListEntry[] => {
    if (!isSuccess) {
      return [];
    }

    return datasets ?? [];
  }, [datasets, isSuccess]);

  useEffect(() => {
    let filterCount = 0;

    const dateRangeParam = params.get(PARAM_KEYS.dateRange);
    if (dateRangeParam) {
      setDateRange(getBestDateRange(Number(dateRangeParam)));
    } else {
      setDateRange(defaultDateRange);
    }

    const allUsers = params.get(PARAM_KEYS.allUsers) !== "false";
    setIsSelectAllUsersChecked(allUsers);
    if (!allUsers) {
      filterCount++;
    }

    const name = params.get(PARAM_KEYS.name);
    setName(name ?? "");
    if (name) {
      filterCount++;
    }

    const datasetType = params.get(PARAM_KEYS.datasetType);
    setDatasetType((datasetType as DatasetTypesSchema) ?? undefined);
    if (datasetType) {
      filterCount++;
    }

    setCreatedAfter(params.get(PARAM_KEYS.createdAfter) ?? undefined);
    setCreatedBefore(params.get(PARAM_KEYS.createdBefore) ?? undefined);

    const users = params.get(PARAM_KEYS.users);
    if (users?.length) {
      setUserFilter(users);
    } else {
      setUserFilter(username);
    }

    // If no buckets in the URL, select all buckets
    const bucketsParam = params.get(PARAM_KEYS.buckets);
    if (!bucketsParam) {
      setBucketFilter(allBucketNames?.join(","));
    } else {
      setBucketFilter(bucketsParam);
      if (allBucketNames && bucketsParam.split(",").length < allBucketNames.length) {
        filterCount++;
      }
    }

    setFilterCount(filterCount);
  }, [params, username, allBucketNames]);

  useEffect(() => {
    if (isSelectAllUsersChecked) {
      setUserType(UserFilterType.ALL);
    } else if (userFilter === username) {
      setUserType(UserFilterType.CURRENT);
    } else {
      setUserType(UserFilterType.CUSTOM);
    }
  }, [isSelectAllUsersChecked, userFilter, username]);

  const validateFilters = useCallback(
    ({ selectedBuckets, dateRange, createdAfter, createdBefore }: DatasetsFilterDataProps): string[] => {
      const errors: string[] = [];
      if (selectedBuckets.length === 0) {
        errors.push("Please select at least one bucket");
      }
      if (dateRange === customDateRange && (createdAfter === undefined || createdBefore === undefined)) {
        errors.push("Please select a date range");
      }
      return errors;
    },
    [],
  );

  useEffect(() => {
    if (
      bucketFilter &&
      validateFilters({
        userType,
        selectedUsers: userFilter,
        selectedBuckets: bucketFilter,
        dateRange,
        createdAfter,
        createdBefore,
        name: name ?? "",
      }).length > 0
    ) {
      setShowFilters(true);
    }
  }, [userFilter, bucketFilter, dateRange, createdAfter, createdBefore, name, userType, validateFilters]);

  useEffect(() => {
    setDateRangeDates(getDateFromValues(dateRange, createdAfter, createdBefore));
  }, [dateRange, createdAfter, createdBefore]);

  const handleRowSelectionChange = useCallback((datasets: DatasetInfo[], bucket?: string) => {
    setSelectedRows({ datasets, bucket });
  }, []);

  const forceRefetch = useCallback(() => {
    // Wait to see if the refresh has already happened. If not call it explicitly
    const lastFetchTime = lastFetchTimeRef.current;

    setSafeTimeout(() => {
      if (!isLoading && lastFetchTimeRef.current === lastFetchTime) {
        void refetch();
      }
    }, 500);
  }, [refetch, isLoading, setSafeTimeout]);

  return (
    <>
      <PageHeader>
        <IconButton
          icon="add"
          text="Create Collection"
          className="btn btn-primary"
          // Disable button if selected rows are from multiple buckets
          aria-disabled={!selectedRows.datasets.length || !selectedRows.bucket}
          onClick={() => {
            if (selectedRows.datasets.length && selectedRows.bucket) {
              setShowCreateCollectionModal(true);
            }
          }}
          title={
            !selectedRows.datasets.length
              ? "Please select at least one dataset"
              : !selectedRows.bucket
                ? "Selected datasets must be from the same bucket"
                : undefined
          }
        />
        <FilterButton
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterCount={filterCount}
          aria-controls="datasets-filters"
        />
      </PageHeader>
      <div className="h-full w-full overflow-x-auto relative">
        <SlideOut
          id="workflows-filters"
          open={showFilters}
          onClose={() => setShowFilters(false)}
          className="w-100 border-t-0"
          aria-label="Datasets Filter"
        >
          {/* By only adding it if showFilters is true, it will reset to url params if closed and reopened */}
          {showFilters && bucketFilter !== undefined && (
            <DatasetsFilter
              datasetsType={datasetType}
              selectedBuckets={bucketFilter}
              selectedUsers={userFilter}
              userType={userType}
              dateRange={dateRange}
              createdAfter={createdAfter}
              createdBefore={createdBefore}
              name={name ?? ""}
              currentUserName={username}
              onRefresh={forceRefetch}
              validateFilters={validateFilters}
            />
          )}
        </SlideOut>
        <DatasetsTable
          processResources={processResources}
          isLoading={isLoading}
          onRowSelectionChange={handleRowSelectionChange}
        />
        <FullPageModal
          open={showCreateCollectionModal}
          onClose={() => setShowCreateCollectionModal(false)}
          headerChildren={<h2 id="create-collection-header">Create Collection</h2>}
          aria-labelledby="create-collection-header"
          size="md"
        >
          {selectedRows.bucket && showCreateCollectionModal && (
            <CreateCollection
              bucket={selectedRows.bucket}
              datasetsInfo={selectedRows.datasets}
            />
          )}
        </FullPageModal>
      </div>
    </>
  );
}
