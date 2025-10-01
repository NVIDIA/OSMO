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

import { TagManager } from "~/components/TagManager";
import {
  AttributeDatasetResponseSchema,
  type DataInfoResponse,
  type DataInfoDatasetEntry,
  type DatasetTypesSchema,
  OSMOErrorResponseSchema,
} from "~/models";
import { api } from "~/trpc/react";

export default function TagEditor({
  dataset,
  selectedVersionData,
  refetch,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>;
  selectedVersionData?: DataInfoDatasetEntry;
  refetch: () => void;
}) {
  const attributeDatasetMutation = api.datasets.attributeDataset.useMutation();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState<boolean>(false);

  const handleSave = useCallback(
    async (setTag: string[], deleteTag: string[]) => {
      if (!dataset || !selectedVersionData?.version) {
        return;
      }

      const response = await attributeDatasetMutation.mutateAsync({
        name: dataset.name,
        bucket: dataset.bucket,
        tag: selectedVersionData?.version,
        set_tag: setTag,
        delete_tag: deleteTag,
      });

      const safeParseResponse = AttributeDatasetResponseSchema.safeParse(response);

      if (safeParseResponse.success) {
        refetch();
        setMessage("Tags updated successfully");
        setIsError(false);
      } else {
        const errorResponse = OSMOErrorResponseSchema.safeParse(response);
        if (errorResponse.success) {
          setMessage(errorResponse.data.message);
        } else {
          setMessage("Failed to update tags");
        }
        setIsError(true);
      }
    },
    [dataset, selectedVersionData?.version, attributeDatasetMutation, refetch],
  );

  return (
    <>
      <TagManager
        currentTags={selectedVersionData?.tags ?? []}
        onSave={handleSave}
        message={message}
        isError={isError}
      />
    </>
  );
}
