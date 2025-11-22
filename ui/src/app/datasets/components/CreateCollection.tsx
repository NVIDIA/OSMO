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

import Link from "next/link";

import FullPageModal from "~/components/FullPageModal";
import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Colors, Tag } from "~/components/Tag";
import { TextInput } from "~/components/TextInput";
import { DatasetTypesSchema, OSMOErrorResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { DatasetPicker } from "./DatasetPicker";

export interface DatasetInfo {
  name: string;
  type: DatasetTypesSchema;
  tags: string[];
  version?: string;
}

const bestTag = (dataset: DatasetInfo) => {
  if (dataset.type === DatasetTypesSchema.Dataset) {
    if (dataset.tags.length > 0) {
      return dataset.tags[0];
    }
    return dataset.version;
  }

  return undefined;
};

interface CreateCollectionProps {
  bucket: string;
  datasetsInfo: DatasetInfo[];
}

export const CreateCollection = ({ bucket, datasetsInfo }: CreateCollectionProps) => {
  const [collectionName, setCollectionName] = useState<string>("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [localDatasetsInfo, setLocalDatasetsInfo] = useState(datasetsInfo);
  const [editingDataset, setEditingDataset] = useState<DatasetInfo | undefined>(undefined);
  const mutation = api.datasets.createCollection.useMutation();

  const handleCreateCollection = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setShowSuccess(false);

    if (!collectionName.trim().length) {
      setError("Collection name is required");
      return;
    }

    if (mutation.isLoading || !localDatasetsInfo.length) {
      return;
    }

    setError(undefined);
    await mutation.mutateAsync(
      {
        name: collectionName,
        bucket: bucket,
        datasets: localDatasetsInfo.map((dataset) => ({
          name: dataset.name,
          tag: dataset.tags[0] ?? dataset.version ?? "",
        })),
      },
      {
        onSuccess: (response) => {
          if (response === null) {
            setShowSuccess(true);
            setError(undefined);
          } else {
            const parsedResponse = OSMOErrorResponseSchema.parse(response);
            setError(parsedResponse.message ?? "Error creating collection");
          }
        },
      },
    );
  };

  return (
    <>
      <form
        onSubmit={handleCreateCollection}
        className="w-full h-full"
      >
        <div className="flex flex-col gap-global w-full h-full overflow-y-auto justify-between">
          <table
            aria-label="Datasets"
            className="w-full border-separate border-spacing-y-0"
          >
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Tag</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {localDatasetsInfo.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="border-none"
                  >
                    <p role="alert">No datasets selected</p>
                  </td>
                </tr>
              ) : (
                localDatasetsInfo.map((dataset) => (
                  <tr key={dataset.name}>
                    <td>{dataset.name}</td>
                    <td>{dataset.type}</td>
                    <td>
                      {dataset.type === DatasetTypesSchema.Dataset && (
                        <button
                          className="btn btn-badge"
                          title={`Edit ${dataset.name}`}
                          type="button"
                          onClick={() => {
                            setEditingDataset(dataset);
                          }}
                        >
                          <Tag color={Colors.tag}>
                            <div className="flex flex-row gap-1 items-center">
                              {bestTag(dataset)}{" "}
                              <FilledIcon
                                name="edit"
                                className="text-sm!"
                              />
                            </div>
                          </Tag>
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-row gap-global">
                        <button
                          className="btn btn-badge"
                          title={`Remove ${dataset.name}`}
                          type="button"
                          onClick={() => {
                            setLocalDatasetsInfo(localDatasetsInfo.filter((d) => d.name !== dataset.name));
                          }}
                        >
                          <Tag color={Colors.error}>
                            <div className="flex flex-row gap-1 items-center">
                              <OutlinedIcon
                                name="delete"
                                className="text-sm!"
                              />
                              Delete
                            </div>
                          </Tag>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="sticky bottom-0 z-10">
            <InlineBanner status={error ? "error" : showSuccess ? "success" : "none"}>
              {error ? (
                error
              ) : showSuccess ? (
                <>
                  Collection created successfully.{" "}
                  <Link href={`/datasets/${bucket}/${collectionName}`}>View Collection</Link>
                </>
              ) : (
                ""
              )}
            </InlineBanner>
            <div className="grid grid-cols-[1fr_auto] gap-global p-global body-footer">
              <TextInput
                id="collection-name"
                aria-label="Collection name"
                required={true}
                value={collectionName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setCollectionName(e.target.value);
                  setError(undefined);
                }}
                placeholder="Enter collection name"
                className="w-full bg-white"
              />
              <button
                className="btn btn-primary"
                aria-disabled={!collectionName || localDatasetsInfo.length === 0}
                type="submit"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </form>
      <FullPageModal
        open={!!editingDataset}
        onClose={() => setEditingDataset(undefined)}
        headerChildren={
          <h3
            className="text-base font-bold p-0 m-0"
            id="edit-dataset-header"
          >
            {editingDataset?.name}
          </h3>
        }
        size="none"
        aria-labelledby="edit-dataset-header"
      >
        {editingDataset && (
          <DatasetPicker
            bucket={bucket}
            name={editingDataset.name}
            value={editingDataset.tags[0] ?? editingDataset.version ?? ""}
            onDone={(tag) => {
              if (tag) {
                editingDataset.tags[0] = tag;
              }
              setEditingDataset(undefined);
            }}
          />
        )}
      </FullPageModal>
    </>
  );
};
