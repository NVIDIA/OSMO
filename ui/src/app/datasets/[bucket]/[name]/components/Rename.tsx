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
import { TextInput } from "~/components/TextInput";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import { useToolParamUpdater } from "../hooks/useToolParamUpdater";

export const Rename = ({
  dataset,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Collection | DatasetTypesSchema.Dataset>;
}) => {
  const mutation = api.datasets.attributeDataset.useMutation();
  const toolParamUpdater = useToolParamUpdater();
  const [newName, setNewName] = useState<string>("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const router = useRouter();
  const { setSafeTimeout } = useSafeTimeout();

  const handleRename = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    setShowSuccess(false);

    await mutation.mutateAsync(
      {
        bucket: dataset.bucket,
        name: dataset.name,
        new_name: newName,
      },
      {
        onSuccess: () => {
          setShowSuccess(true);
          setSafeTimeout(() => {
            router.replace(`/datasets/${dataset.bucket}/${newName}`);
          }, 1000);
        },
        onError: (error) => {
          setError(error.message ?? "Failed to rename collection");
          setLoading(false);
        },
      },
    );
  };

  return (
    <form onSubmit={handleRename}>
      <div className="flex flex-col justify-between">
        <div className="p-3 w-100 flex flex-col gap-3">
          <TextInput
            id="current-name"
            label="Current Name"
            value={dataset.name}
            readOnly
            className="w-full"
          />
          <TextInput
            id="new-name"
            label="New Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex flex-col">
          {error && <InlineBanner status="error">{error}</InlineBanner>}
          {showSuccess && <InlineBanner status="success">Collection renamed successfully</InlineBanner>}
          <div className="modal-footer">
            {!showSuccess && (
              <button
                className="btn btn-secondary"
                onClick={() => toolParamUpdater({ tool: null })}
                type="button"
              >
                Cancel
              </button>
            )}
            <button
              className="btn btn-primary h-8"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <Spinner
                  className="border-black"
                  size="button"
                />
              ) : (
                <OutlinedIcon name="drive_file_rename_outline" />
              )}
              Rename
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
