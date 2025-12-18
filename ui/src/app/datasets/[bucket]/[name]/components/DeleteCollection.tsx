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

import { useRouter } from "next/navigation";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Spinner } from "~/components/Spinner";
import { UrlTypes, useStore } from "~/components/StoreProvider";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import { useToolParamUpdater } from "../hooks/useToolParamUpdater";

export const DeleteCollection = ({ dataset }: { dataset: DataInfoResponse<DatasetTypesSchema.Collection> }) => {
  const mutation = api.datasets.deleteDataset.useMutation();
  const toolParamUpdater = useToolParamUpdater();
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const { setSafeTimeout } = useSafeTimeout();

  const router = useRouter();
  const { sidebarData } = useStore();

  const handleDelete = async () => {
    if (loading || mutation.isLoading) {
      return;
    }
    setLoading(true);
    setError(undefined);
    setShowSuccess(false);

    await mutation.mutateAsync(
      {
        name: dataset.name,
        bucket: dataset.bucket,
      },
      {
        onSuccess: () => {
          setShowSuccess(true);
          setSafeTimeout(() => {
            router.replace(`/datasets${sidebarData.get(UrlTypes.Datasets)}`);
          }, 1000);
        },
        onError: (error) => {
          setError(error.message ?? "Failed to delete collection");
          setLoading(false);
        },
      },
    );
  };

  return (
    <div className="flex flex-col justify-between">
      <p className="px-global py-6">Are you sure you want to delete this collection?</p>
      <InlineBanner status={error ? "error" : showSuccess ? "success" : "none"}>
        {error ? error : showSuccess ? "Collection deleted successfully" : ""}
      </InlineBanner>
      <div className="modal-footer">
        {!showSuccess && (
          <button
            className="btn btn-secondary"
            onClick={() => toolParamUpdater({ tool: null })}
          >
            Cancel
          </button>
        )}
        <button
          className="btn btn-primary h-8"
          onClick={handleDelete}
          aria-disabled={loading || mutation.isLoading}
        >
          {loading || mutation.isLoading ? (
            <Spinner
              className="border-black"
              size="button"
            />
          ) : (
            <OutlinedIcon name="delete" />
          )}
          Delete
        </button>
      </div>
    </div>
  );
};
