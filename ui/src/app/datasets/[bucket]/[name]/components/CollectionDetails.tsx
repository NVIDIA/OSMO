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

import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";
import { Colors, Tag } from "~/components/Tag";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { convertToReadableTimezone } from "~/utils/string";

import { ToolType, useToolParamUpdater } from "../hooks/useToolParamUpdater";

interface DatasetDetailsProps {
  dataset: DataInfoResponse<DatasetTypesSchema.Collection>;
}

export const CollectionDetails = ({ dataset }: DatasetDetailsProps) => {
  const toolParamUpdater = useToolParamUpdater();

  return (
    <div className="h-full flex flex-col overflow-y-auto w-[33vw] max-w-150 body-component shadow-lg shadow-black/50 z-10">
      <section
        aria-labelledby="details-title"
        className="h-full w-full flex flex-col dag-details-body"
      >
        <h2
          id="details-title"
          className="text-center p-global font-semibold brand-header"
        >
          {dataset.name}
        </h2>
        <div className="h-full">
          <dl
            className="p-global"
            aria-labelledby="details-title"
          >
            <dt>ID</dt>
            <dd>{dataset.id}</dd>
            <dt>Bucket</dt>
            <dd>
              <Link
                key={dataset.bucket}
                href={`/datasets/${dataset.bucket}`}
                className="tag-container"
              >
                <Tag color={Colors.platform}>{dataset.bucket}</Tag>
              </Link>
            </dd>
            {dataset.created_by && (
              <>
                <dt>Created By</dt>
                <dd>{dataset.created_by}</dd>
              </>
            )}
            <dt>Created Date</dt>
            <dd>{convertToReadableTimezone(dataset.created_date)}</dd>
            <dt>Labels</dt>
            <dd>
              {Object.entries(dataset.labels).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(dataset.labels).map(([key, value], index) => (
                    <Tag
                      key={index}
                      color={Colors.tag}
                    >
                      {key}: {String(value)}
                    </Tag>
                  ))}
                </div>
              ) : (
                <p>None</p>
              )}
            </dd>
          </dl>
        </div>
        <div
          className={`dag-actions body-footer w-full`}
          role="list"
          aria-label="Collection Actions"
        >
          <button
            className="btn btn-action whitespace-nowrap"
            role="listitem"
            onClick={() => {
              toolParamUpdater({ tool: ToolType.Labels });
            }}
          >
            <OutlinedIcon name="snippet_folder" />
            Edit Labels
          </button>
          <button
            className="btn btn-action whitespace-nowrap"
            role="listitem"
            onClick={() => {
              toolParamUpdater({ tool: ToolType.Delete });
            }}
          >
            <OutlinedIcon name="delete" />
            Delete Collection
          </button>
          <button
            className="btn btn-action whitespace-nowrap"
            role="listitem"
            onClick={() => {
              toolParamUpdater({ tool: ToolType.Rename });
            }}
          >
            <OutlinedIcon name="snippet_folder" />
            Rename Collection
          </button>
        </div>
      </section>
    </div>
  );
};
