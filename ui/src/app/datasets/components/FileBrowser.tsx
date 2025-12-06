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

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  ChonkyActions,
  type ChonkyFileActionData,
  FileBrowser as ChonkyFileBrowser,
  type FileArray,
  type FileData,
  FileHelper,
  FileList,
  FileNavbar,
  FileToolbar,
  setChonkyDefaults,
} from "chonky";
import { ChonkyIconFA } from "chonky-icon-fontawesome";
import Link from "next/link";

import { FilledIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { Spinner } from "~/components/Spinner";
import { type DataInfoDatasetEntry, type DataInfoResponse, type DatasetTypesSchema, type FileDataItem } from "~/models";
import { api } from "~/trpc/react";

// Payload type provided on Chonky website
type MouseClickFilePayload = {
  altKey: boolean;
  clickType: "single" | "double";
  ctrlKey: boolean;
  file: FileData;
  fileDisplayIndex: number;
  shiftKey: boolean;
};

interface DatasetFileBrowserProps {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset>;
  currentVersion: DataInfoDatasetEntry;
  onOpenFile: (data: FilePreviewModalProps) => void;
}

export interface FilePreviewModalProps {
  files: FileArray;
  selectedFile: FileData;
  currentFolderName: string;
  selectedIndex: number;
}

const transformFilesData = (datasetName: string, filesData: FileDataItem[]) => {
  const rootFolderId = datasetName;
  const fileMap: Record<string, FileData & { childrenIds: string[] }> = {};

  // Initialize root folder
  fileMap[rootFolderId] = {
    id: rootFolderId,
    name: datasetName,
    isDir: true,
    childrenIds: [],
    childrenCount: 0,
  };

  // Process each file and create folder structure
  filesData?.forEach((file) => {
    const pathParts = file.relative_path.split("/");
    let currentFolderName = rootFolderId;

    pathParts.forEach((part, index) => {
      const isFile = index === pathParts.length - 1;
      const id = pathParts.slice(0, index + 1).join("/");

      // Create new folder/file entry if it doesn't exist
      if (!fileMap[id]) {
        fileMap[id] = {
          id,
          name: part,
          isDir: !isFile,
          childrenIds: [],
          childrenCount: 0,
          parentId: currentFolderName,
        };

        // Update parent folder
        const currentFolder = fileMap[currentFolderName]!;
        if (currentFolder.childrenIds && currentFolder.childrenCount !== undefined) {
          currentFolder.childrenIds.push(id);
          currentFolder.childrenCount++;
        }
      }

      if (isFile) {
        const fileEntry = fileMap[id];
        if (fileEntry) {
          fileEntry.size = file.size;
          fileEntry.thumbnailUrl = file.url;
        }
      }

      currentFolderName = id;
    });
  });

  const sortedKeys = Object.keys(fileMap).sort((a, b) => b.length - a.length);

  // Calculating total folder sizes
  sortedKeys.forEach((id) => {
    const file = fileMap[id]!;
    if (file.isDir) {
      file.size = file.childrenIds.reduce((acc, childId) => {
        return acc + (fileMap[childId]!.size ?? 0);
      }, 0);
    }
  });

  return { rootFolderId, fileMap };
};

// Memoized hook to get files for the current folder
const useFiles = (
  fileMap: Record<string, FileData & { childrenIds?: string[] }>,
  currentFolderName: string,
): FileArray => {
  return useMemo(() => {
    const currentFolder = fileMap[currentFolderName];
    const files = currentFolder?.childrenIds?.map((fileId) => fileMap[fileId] ?? null) ?? [];
    return files;
  }, [fileMap, currentFolderName]);
};

// Hook to generate folder chain for breadcrumbs
const useFolderChain = (
  fileMap: Record<string, FileData & { parentId?: string }>,
  currentFolderName: string,
): FileArray => {
  return useMemo(() => {
    const currentFolder = fileMap[currentFolderName];
    if (!currentFolder) {
      return [];
    }

    const folderChain = [currentFolder];

    // Traverse up the folder hierarchy
    let parentId = currentFolder.parentId;
    while (parentId) {
      const parentFile = fileMap[parentId];
      if (parentFile) {
        folderChain.unshift(parentFile);
        parentId = parentFile.parentId;
      } else {
        break;
      }
    }

    return folderChain;
  }, [fileMap, currentFolderName]);
};

const useFileActionHandler = (
  setCurrentFolderName: (folderId: string) => void,
  handleOpenFile: (file: FileData) => void,
) => {
  return useCallback(
    (data: ChonkyFileActionData) => {
      // Handle mouse click events on files
      if (data.id === ChonkyActions.MouseClickFile.id) {
        const { clickType, file } = data.payload as MouseClickFilePayload;
        // Open non-directory files on double-click
        if (clickType === "double" && !FileHelper.isDirectory(file)) {
          handleOpenFile(file);
        }
      } else if (data.id === ChonkyActions.KeyboardClickFile.id) {
        const { file } = data.payload;
        if (!FileHelper.isDirectory(file)) {
          handleOpenFile(file);
        }
      } else if (data.id === ChonkyActions.OpenFiles.id) {
        /** Handle "Open" action, @see https://chonky.io/docs/2.x/file-actions/built-in-actions */
        const { targetFile, files } = data.payload;

        // Use targetFile if available, otherwise use the first file in the array
        const fileToOpen = targetFile ?? files[0];

        // If the opened item is a directory, update the current folder
        if (fileToOpen && FileHelper.isDirectory(fileToOpen)) {
          setCurrentFolderName(fileToOpen.id);
        }
      }
    },
    [setCurrentFolderName, handleOpenFile],
  );
};

const FileBrowser: React.FC<DatasetFileBrowserProps> = ({ dataset, currentVersion, onOpenFile }) => {
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);

  const {
    data: filesData,
    isSuccess,
    error,
    isLoading,
  } = api.datasets.getFiles.useQuery(
    { url: currentVersion.location },
    {
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  useEffect(() => {
    if (filesData) {
      const { rootFolderId } = transformFilesData(dataset.name, filesData);
      setCurrentFolderName(rootFolderId);
    }
  }, [filesData, dataset.name]);

  // Transform raw file data into a hierarchical structure
  const { rootFolderId, fileMap } = transformFilesData(dataset.name, filesData!);

  // Get files for the current folder
  const files = useFiles(fileMap, currentFolderName ?? rootFolderId);

  // Generate the folder chain (breadcrumbs) for navigation
  const folderChain = useFolderChain(fileMap, currentFolderName ?? rootFolderId);

  const handleOpenFile = (file: FileData | null) => {
    if (file && !file.isDir) {
      onOpenFile({
        files: files.filter((file) => file && !file.isDir),
        selectedFile: file,
        currentFolderName: currentFolderName ?? "/",
        selectedIndex: files.findIndex((f) => f?.id === file.id),
      });
    }
  };

  // Distinction between selecting a folder and selecting a file
  const handleFileBrowserAction = useFileActionHandler(setCurrentFolderName, handleOpenFile);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Spinner
          size="medium"
          description="Loading Files..."
        ></Spinner>
      </div>
    );
  }

  if (error) {
    if (error.data?.code === "UNAUTHORIZED") {
      return (
        <PageError
          title="Access Denied"
          errorMessage="You are not authorized to access this dataset."
        />
      );
    }

    return (
      <PageError
        title="Files Not Supported"
        errorMessage="We can't JSONify your files at this time."
        subTextTitle="File structure not supported for this version"
        subText="This is likely due to your dataset version not being a Manifest file."
      >
        {currentVersion.location.startsWith("https") && (
          <>
            <p>Please visit the URL below to access and download them.</p>
            <Link
              className="btn btn-secondary"
              href={currentVersion.location}
              target="_blank"
              rel="noopener noreferrer"
            >
              Browse Files
              <FilledIcon name="open_in_new" />
            </Link>
          </>
        )}
      </PageError>
    );
  }

  if (!filesData || currentFolderName === null) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/ban-ts-comment
  // @ts-ignore
  setChonkyDefaults({
    iconComponent: ChonkyIconFA as any,
    disableDragAndDropProvider: true,
  });

  if (!isSuccess) {
    return null;
  }

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    <ChonkyFileBrowser
      instanceId="file-browser"
      files={files}
      folderChain={folderChain}
      onFileAction={handleFileBrowserAction}
      disableSelection={true}
      defaultFileViewActionId={ChonkyActions.EnableListView.id}
      thumbnailGenerator={(file: FileData) => {
        // Only render thumbnail for PNG, JPEG, GIF and MP4
        if (file.name.match(/\.(mp4|png|jpe?g)$/)) {
          return file.thumbnailUrl;
        }
      }}
      disableDefaultFileActions={[
        ChonkyActions.MouseClickFile.id,
        ChonkyActions.OpenSelection.id,
        ChonkyActions.SelectAllFiles.id,
        ChonkyActions.ClearSelection.id,
        ChonkyActions.SortFilesByDate.id,
        ChonkyActions.ToggleHiddenFiles.id,
        ChonkyActions.ChangeSelection.id,
      ]}
    >
      <FileNavbar />
      <FileToolbar />
      <FileList />
    </ChonkyFileBrowser>
  );
};

export default FileBrowser;
