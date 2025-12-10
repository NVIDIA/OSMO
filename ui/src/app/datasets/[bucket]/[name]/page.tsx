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

import { PageError } from "~/components/PageError";
import { Spinner } from "~/components/Spinner";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import CollectionOverview from "./components/CollectionOverview";
import DatasetOverview from "./components/DatasetOverview";

export default function DatasetPage({ params }: { params: { bucket: string; name: string } }) {
  const {
    data: dataset,
    error,
    refetch,
  } = api.datasets.getDatasetInfo.useQuery(
    {
      bucket: params.bucket,
      name: params.name,
    },
    {
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  if (error) {
    return (
      <PageError
        className="h-full"
        title="Failed to Fetch Dataset"
        errorMessage={error.message}
      />
    );
  }

  if (!dataset) {
    return (
      <div className="h-full w-full flex justify-center items-center">
        <Spinner
          description="Loading Dataset..."
          size="large"
        />
      </div>
    );
  }

  return dataset.type === "DATASET" ? (
    <DatasetOverview
      dataset={dataset as DataInfoResponse<DatasetTypesSchema.Dataset>}
      refetch={refetch}
    />
  ) : (
    <CollectionOverview
      dataset={dataset as DataInfoResponse<DatasetTypesSchema.Collection>}
      refetch={refetch}
    />
  );
}
