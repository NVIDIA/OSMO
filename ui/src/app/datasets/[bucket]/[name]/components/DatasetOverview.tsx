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

import { useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import FileBrowser, { type FilePreviewModalProps } from "~/app/datasets/components/FileBrowser";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { Colors, Tag } from "~/components/Tag";
import { type DataInfoDatasetEntry, type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { api } from "~/trpc/react";

import { DatasetDetails } from "./DatasetDetails";
import { DatasetVersionDetails } from "./DatasetVersionDetails";
import { DatasetVersionsTable } from "./DatasetVersionsTable";
import PagedFilePreviewer from "./PagedFilePreviewer";
import { ToolsModal } from "./ToolsModal";
import { PARAM_KEYS, type ToolType, useToolParamUpdater } from "../hooks/useToolParamUpdater";

export default function DatasetOverview({
  dataset,
  refetch,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset>;
  refetch: () => void;
}) {
  const searchParams = useSearchParams();
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(undefined);
  const [previousVersion, setPreviousVersion] = useState<string | undefined>(undefined);
  const [nextVersion, setNextVersion] = useState<string | undefined>(undefined);
  const [showVersions, setShowVersions] = useState<boolean>(false);
  const [tool, setTool] = useState<ToolType | undefined>(undefined);
  const [openFileData, setOpenFileData] = useState<FilePreviewModalProps | undefined>(undefined);
  const toolParamUpdater = useToolParamUpdater();

  const {
    data: selectedVersionData,
    error: errorSelectedVersionData,
    refetch: refetchSelectedVersionData,
  } = api.datasets.getDatasetInfo.useQuery(
    {
      bucket: dataset.bucket,
      name: dataset.name,
      tag: selectedVersion,
      count: 1,
    },
    {
      refetchOnWindowFocus: false,
      retry: false,
      select: (data) => (data?.versions.length ? (data.versions[0] as DataInfoDatasetEntry) : undefined),
    },
  );

  useEffect(() => {
    if (selectedVersion) {
      const selectedVersionIndex = dataset.versions.findIndex((version) => version.version === selectedVersion);
      setPreviousVersion(dataset.versions[selectedVersionIndex - 1]?.version);
      setNextVersion(dataset.versions[selectedVersionIndex + 1]?.version);
    } else {
      setPreviousVersion(undefined);
      setNextVersion(undefined);
    }
  }, [selectedVersion, dataset]);

  useEffect(() => {
    const versionParam = searchParams.get(PARAM_KEYS.version);
    setSelectedVersion(versionParam ?? dataset?.versions[dataset.versions.length - 1]?.version);

    setTool(searchParams.get(PARAM_KEYS.tool) as ToolType | undefined);
    setShowVersions(searchParams.get(PARAM_KEYS.showVersions) === "true");
  }, [searchParams, dataset]);

  return (
    <>
      <PageHeader>
        <div className="flex flex-row gap-1 items-center justify-center grow">
          {previousVersion ? (
            <Link
              href={`/datasets/${dataset.bucket}/${dataset.name}?version=${previousVersion}`}
              title="Previous Version"
            >
              <OutlinedIcon
                name="keyboard_double_arrow_left"
                className="text-lg!"
              />
            </Link>
          ) : (
            <OutlinedIcon
              name="keyboard_double_arrow_left"
              className="text-lg! mx-1 opacity-50"
            />
          )}
          <h2 className="whitespace-nowrap overflow-hidden text-ellipsis">
            {dataset.bucket}/{dataset.name}
          </h2>
          {nextVersion ? (
            <Link
              href={`/datasets/${dataset.bucket}/${dataset.name}?version=${nextVersion}`}
              title="Next Version"
            >
              <OutlinedIcon
                name="keyboard_double_arrow_right"
                className="text-lg!"
              />
            </Link>
          ) : (
            <OutlinedIcon
              name="keyboard_double_arrow_right"
              className="text-lg! mx-1 opacity-50"
            />
          )}
        </div>
        <Tag color={Colors.dataset}>Dataset</Tag>
        <IconButton
          className="btn btn-primary"
          onClick={() => toolParamUpdater({ showVersions: true })}
          icon="layers"
          text="Versions"
        />
      </PageHeader>
      {errorSelectedVersionData && (
        <PageError
          title="Failed to fetch dataset"
          errorMessage={errorSelectedVersionData.message}
        />
      )}
      {selectedVersionData && (
        <div
          className={`grid h-full w-full overflow-x-auto ${openFileData ? "grid-cols-[1fr_1fr]" : "grid-cols-[1fr_auto]"}`}
        >
          <div className="relative min-w-100 h-full border-t-1 border-border">
            <FileBrowser
              currentVersion={selectedVersionData}
              dataset={dataset}
              onOpenFile={setOpenFileData}
            />
          </div>
          {openFileData ? (
            <PagedFilePreviewer
              currentFolderName={openFileData.currentFolderName}
              files={openFileData.files}
              selectedFile={openFileData.selectedFile}
              selectedIndex={openFileData.selectedIndex}
              onUpdateSelection={(newIndex) => {
                if (newIndex === -1) {
                  setOpenFileData(undefined);
                } else {
                  setOpenFileData({
                    ...openFileData,
                    selectedIndex: newIndex,
                    selectedFile: openFileData.files[newIndex]!,
                  });
                }
              }}
            />
          ) : (
            <div className="h-full flex flex-col justify-between overflow-y-auto w-[33vw] max-w-150">
              <DatasetDetails dataset={dataset} />
              <DatasetVersionDetails
                datasetVersion={selectedVersionData}
                bucket={dataset.bucket}
              />
            </div>
          )}
        </div>
      )}
      <FullPageModal
        open={showVersions}
        onClose={() => toolParamUpdater({ showVersions: false })}
        headerChildren={<h2 id="versions-header">Versions</h2>}
        aria-labelledby="versions-header"
      >
        <DatasetVersionsTable
          dataset={dataset}
          selectedVersion={selectedVersion}
          visible={showVersions}
        />
      </FullPageModal>
      <ToolsModal
        tool={tool}
        selectedVersionData={selectedVersionData}
        refetch={() => {
          refetch();
          void refetchSelectedVersionData();
        }}
        dataset={dataset}
      />
    </>
  );
}
