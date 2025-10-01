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

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWindowSize } from "usehooks-ts";

import FileBrowser, { type FilePreviewModalProps } from "~/app/datasets/components/FileBrowser";
import FullPageModal from "~/components/FullPageModal";
import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { DatasetTag } from "~/components/Tag";
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
  const headerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const windowSize = useWindowSize();
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (containerRef?.current) {
      setHeight(windowSize.height - containerRef.current.getBoundingClientRect().top);
    }
  }, [windowSize.height, openFileData, selectedVersionData]);

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
      <div
        className="page-header flex items-center text-center gap-3"
        ref={headerRef}
      >
        <DatasetTag
          key="type"
          isCollection={dataset.type === "COLLECTION"}
        >
          {dataset.type}
        </DatasetTag>
        <div className="flex flex-row gap-1 items-center">
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
          <h1>
            {dataset.bucket}/{dataset.name}: {selectedVersion ?? "latest"}
          </h1>
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
        <button
          className="btn btn-primary flex flex-row items-center gap-2"
          onClick={() => toolParamUpdater({ showVersions: true })}
        >
          <FilledIcon name="layers" />
          Versions
          <FilledIcon name="more_vert" />
        </button>
      </div>
      {errorSelectedVersionData && (
        <PageError
          title="Failed to fetch dataset"
          errorMessage={errorSelectedVersionData.message}
        />
      )}
      {selectedVersionData && (
        <div
          className={`grid h-full w-full gap-3 relative pl-3 ${
            openFileData ? "grid-cols-[1fr_1fr]" : "grid-cols-[1fr_auto]"
          }`}
        >
          <div className="relative body-component my-3 min-w-100">
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
            <div ref={containerRef}>
              <div
                className="h-full flex flex-col overflow-y-auto gap-3 w-[33vw] max-w-150 py-3 pr-3"
                style={{
                  height: `${height}px`,
                }}
              >
                <DatasetDetails dataset={dataset} />
                <DatasetVersionDetails
                  datasetVersion={selectedVersionData}
                  bucket={dataset.bucket}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <FullPageModal
        open={showVersions}
        onClose={() => toolParamUpdater({ showVersions: false })}
        headerChildren={<h2>Versions</h2>}
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
