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

import React, { useEffect, useRef, useState } from "react";

import { type FileData } from "chonky";
import { useWindowSize } from "usehooks-ts";

import { OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { useSafeTimeout } from "~/hooks/useSafeTimeout";

const FilePreviewer: React.FC<{ file: FileData }> = ({ file }) => {
  // Tracking if iframe errors out when trying to render a file
  const [iframeError, setIframeError] = useState(false);
  const iframeLoaded = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const fileExtension = file.name.split(".").pop()?.toLowerCase();
  const containerRef = useRef<HTMLDivElement>(null);
  const windowSize = useWindowSize();
  const [height, setHeight] = useState(0);
  const { setSafeTimeout } = useSafeTimeout();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (containerRef?.current) {
      setHeight(windowSize.height - containerRef.current.getBoundingClientRect().top - 30);
    }
  }, [windowSize.height, iframeError]);

  // Resetting iframe state when selectedIndex or fileExtension changes
  useEffect(() => {
    setIframeError(false);
    iframeLoaded.current = false;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (
      fileExtension !== "mp4" &&
      fileExtension !== "png" &&
      fileExtension !== "jpg" &&
      fileExtension !== "jpeg" &&
      fileExtension !== "gif"
    ) {
      timerRef.current = setSafeTimeout(() => {
        if (!iframeLoaded.current) {
          setIframeError(true);
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [fileExtension, setSafeTimeout]);

  useEffect(() => {
    videoRef.current?.load();
  }, [file.thumbnailUrl]);

  const handleIframeError = () => {
    setIframeError(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const handleIframeLoad = () => {
    iframeLoaded.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const renderContent = () => {
    switch (fileExtension) {
      case "mp4":
        return (
          <video
            ref={videoRef}
            controls
            style={{ maxHeight: `${height}px` }}
            className="object-fit"
          >
            <source
              src={file.thumbnailUrl}
              type="video/mp4"
            />
          </video>
        );
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            style={{ maxHeight: `${height}px` }}
            onError={handleIframeError}
          />
        );
      default:
        return (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin"
            src={file.thumbnailUrl}
            onLoad={handleIframeLoad}
            className="h-full w-full"
            onError={handleIframeError}
          />
        );
    }
  };

  if (iframeError) {
    return (
      <PageError
        title="Unable to preview this file type."
        errorMessage=""
      >
        <a
          target="_blank"
          href={file.thumbnailUrl}
          download={file.name}
          data-filename={file.name}
          className="btn btn-secondary"
        >
          <OutlinedIcon name="download" />
          Download File
        </a>
      </PageError>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center"
    >
      {renderContent()}
    </div>
  );
};

export default FilePreviewer;
