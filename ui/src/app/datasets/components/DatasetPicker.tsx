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
import { useEffect, useState } from "react";

import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { DatasetTypesSchema, type DataInfoResponse } from "~/models";
import { api } from "~/trpc/react";

interface DatasetPickerProps {
  bucket: string;
  name: string;
  value: string;
  onDone: (tag?: string) => void;
}

export const DatasetPicker = ({ bucket, name, value, onDone }: DatasetPickerProps) => {
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>(value);

  const { data, isLoading } = api.datasets.getDatasetInfo.useQuery({
    name: name,
    bucket: bucket,
    count: 1000,
  });

  useEffect(() => {
    if (data && data.type === DatasetTypesSchema.Dataset) {
      const datasetInfo = data as DataInfoResponse<DatasetTypesSchema.Dataset>;
      const allTags = new Set<string>();
      datasetInfo.versions.forEach((version) => {
        version.tags.forEach((tag) => allTags.add(tag));
        allTags.add(version.version);
      });
      setTags(
        Array.from(allTags).sort((a, b) => {
          if (a === "latest") return -1;
          if (b === "latest") return 1;
          // Alphanumeric (natural) compare
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        }),
      );
    } else {
      setTags([]);
    }
  }, [data]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onDone(selectedTag);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full p-3 w-full">
        <Spinner size="small" />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 w-full"
    >
      <div className="grid grid-cols-[1fr_auto] gap-3 w-full">
        <Select
          id="tag"
          aria-label="Tag"
          value={selectedTag}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTag(e.target.value)}
          className="w-full"
        >
          {Array.from(tags).map((tag) => (
            <option
              key={tag}
              value={tag}
            >
              {tag}
            </option>
          ))}
        </Select>
        <button
          className="btn btn-primary"
          title="Save"
          type="submit"
        >
          Update
        </button>
      </div>
    </form>
  );
};
