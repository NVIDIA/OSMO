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
import { useState } from "react";

import { JSONEditor } from "~/components/JSONEditor";
import { PageError } from "~/components/PageError";
import {
  type DataInfoDatasetEntry,
  type DataInfoResponse,
  AttributeDatasetResponseSchema,
  DatasetTypesSchema,
  OSMOErrorResponseSchema,
} from "~/models";
import { api } from "~/trpc/react";

import { useToolParamUpdater } from "../hooks/useToolParamUpdater";

export const MetadataEditor = ({
  dataset,
  selectedVersionData,
  refetch,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>;
  selectedVersionData?: DataInfoDatasetEntry;
  refetch: () => void;
}) => {
  const attributeDatasetMutation = api.datasets.attributeDataset.useMutation();
  const toolParamUpdater = useToolParamUpdater();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState<boolean>(false);

  // Returns true if the save was successful, false otherwise
  const onSaveMeta = async (deletedFields: string[], updatedData: Record<string, unknown>): Promise<boolean> => {
    if (!dataset || dataset.type !== DatasetTypesSchema.Dataset) {
      return false;
    }

    const response = await attributeDatasetMutation.mutateAsync({
      name: dataset.name,
      bucket: dataset.bucket,
      delete_metadata: deletedFields,
      set_metadata: updatedData,
    });

    // Ensuring we're not receiving an OSMOErrorResponse
    const safeParseResponse = AttributeDatasetResponseSchema.safeParse(response);

    if (safeParseResponse.success) {
      refetch();
      setMessage("Metadata updated successfully");
      setIsError(false);
    } else {
      const errorResponse = OSMOErrorResponseSchema.safeParse(response);
      if (errorResponse.success) {
        setMessage(errorResponse.data.message);
      } else {
        setMessage("Failed to update metadata");
      }
      setIsError(true);
      return false;
    }
    return true;
  };

  if (dataset.type === DatasetTypesSchema.Collection) {
    return (
      <PageError
        title="Metadata is not supported for collections"
        errorMessage=""
      />
    );
  }

  return (
    <>
      <JSONEditor
        initialData={selectedVersionData?.metadata ?? {}}
        onSave={onSaveMeta}
        message={message}
        isError={isError}
        onCancel={() => {
          toolParamUpdater({ tool: null });
        }}
        onFormatError={(error) => {
          if (error) {
            setMessage(error);
            setIsError(true);
          } else {
            setMessage(null);
            setIsError(false);
          }
        }}
      />
    </>
  );
};
