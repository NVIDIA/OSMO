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
import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";
import { Colors, DatasetTag, Tag } from "~/components/Tag";
import { type DataInfoDatasetEntry } from "~/models";
import { convertBytes, convertToReadableTimezone, formatForWrapping } from "~/utils/string";

import { ToolType, useToolParamUpdater } from "../hooks/useToolParamUpdater";

interface DatasetVersionDetailsProps {
  datasetVersion: DataInfoDatasetEntry;
  bucket: string;
}

export const DatasetVersionDetails = ({ datasetVersion, bucket }: DatasetVersionDetailsProps) => {
  const toolParamUpdater = useToolParamUpdater();

  return (
    <section
      aria-labelledby="dataset-version-details-title"
      className="body-component"
    >
      <h2
        id="dataset-version-details-title"
        className="text-center p-global font-semibold brand-header"
      >
        Version {datasetVersion.version}
      </h2>
      <dl
        className="p-global grow"
        aria-labelledby="dataset-version-details-title"
      >
        <dt>Status</dt>
        <dd>{datasetVersion.status}</dd>
        <dt>Created By</dt>
        <dd>{formatForWrapping(datasetVersion.created_by)}</dd>
        <dt>Created Date</dt>
        <dd>{convertToReadableTimezone(datasetVersion.created_date)}</dd>
        <dt>Last Used</dt>
        <dd>{convertToReadableTimezone(datasetVersion.last_used)}</dd>
        <dt>Size</dt>
        <dd>{convertBytes(datasetVersion.size)}</dd>
        <dt>Retention Policy</dt>
        <dd>{Math.floor(datasetVersion.retention_policy / (24 * 60 * 60))} days</dd>
        <dt>Tags</dt>
        <dd>
          <div className="flex flex-wrap gap-1">
            {datasetVersion.tags.map((tag, index) => (
              <Tag
                key={index}
                color={Colors.tag}
                className="min-h-6 break-all"
              >
                {tag}
              </Tag>
            ))}
          </div>
        </dd>
        <dt>Related Collections</dt>
        <dd>
          <div className="flex flex-wrap gap-1">
            {datasetVersion.collections.length > 0 ? (
              datasetVersion.collections.map((collection) => (
                <Link
                  key={collection}
                  href={`/datasets/${bucket}/${collection}`}
                  className="btn btn-badge"
                >
                  <DatasetTag isCollection>{collection}</DatasetTag>
                </Link>
              ))
            ) : (
              <p>None</p>
            )}
          </div>
        </dd>
      </dl>
      <div
        className={`dag-actions body-footer w-full`}
        role="list"
        aria-label="Dataset VersionActions"
      >
        <button
          className="btn btn-action whitespace-nowrap"
          role="listitem"
          onClick={() => toolParamUpdater({ tool: ToolType.Tags })}
        >
          <OutlinedIcon name="data_object" />
          Edit Tags
        </button>
        <button
          className="btn btn-action whitespace-nowrap"
          role="listitem"
          onClick={() => toolParamUpdater({ tool: ToolType.Metadata })}
        >
          <OutlinedIcon name="data_object" />
          Metadata
        </button>
      </div>
    </section>
  );
};
