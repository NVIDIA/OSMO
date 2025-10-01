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
import { useCallback, useState } from "react";

import { RecordBuilder } from "~/components/RecordBuilder";
import {
  AttributeDatasetResponseSchema,
  type DatasetTypesSchema,
  type DataInfoResponse,
  OSMOErrorResponseSchema,
} from "~/models";
import { api } from "~/trpc/react";

export const LabelEditor = ({
  dataset,
  refetch,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>;
  refetch: () => void;
}) => {
  const attributeDatasetMutation = api.datasets.attributeDataset.useMutation();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSave = useCallback(
    async (deletedFields: Record<string, unknown>, updatedData: Record<string, unknown>) => {
      if (!dataset) {
        return;
      }

      // We pass in the response from the Record Builder into the API to set/delete labels
      const response = await attributeDatasetMutation.mutateAsync({
        name: dataset.name,
        bucket: dataset.bucket,
        delete_label: Object.keys(deletedFields),
        set_label: updatedData,
      });

      // Ensuring response is not a OSMOErrorResponse
      const safeParseResponse = AttributeDatasetResponseSchema.safeParse(response);

      if (safeParseResponse.success) {
        setMessage("Labels updated successfully");
        setIsError(false);
        refetch();
      } else {
        const errorResponse = OSMOErrorResponseSchema.safeParse(response);
        if (errorResponse.success) {
          setMessage(errorResponse.data.message);
        } else {
          setMessage("Failed to update labels");
        }
        setIsError(true);
      }
    },
    [dataset, refetch, attributeDatasetMutation],
  );

  return (
    <>
      <RecordBuilder
        title="Labels"
        initialData={dataset.labels ?? {}}
        onSave={handleSave}
        message={message}
        isError={isError}
      />
    </>
  );
};
