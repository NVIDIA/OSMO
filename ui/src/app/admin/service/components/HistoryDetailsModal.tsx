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

import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Colors, Tag } from "~/components/Tag";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import { type ServiceConfigHistoryItem } from "~/models/config/service-config";

import { ServiceConfigOverview } from "./ServiceConfigOverview";

interface HistoryDetailsModalProps {
  open: boolean;
  onClose: () => void;
  configs: ServiceConfigHistoryItem[];
  historyIndex?: number;
  setHistoryIndex: (index: number) => void;
}

export const HistoryDetailsModal = ({
  open,
  onClose,
  configs,
  historyIndex,
  setHistoryIndex,
}: HistoryDetailsModalProps) => {
  const [isShowingJSON, setIsShowingJSON] = useState(false);
  const lastConfigIndex = useRef<number | undefined>(undefined);

  const currentConfig = historyIndex !== undefined ? configs[historyIndex] : undefined;
  const previousVersion = historyIndex !== undefined ? configs[historyIndex + 1] : undefined;
  const nextVersion = historyIndex !== undefined ? configs[historyIndex - 1] : undefined;
  const lastConfig = lastConfigIndex.current !== undefined ? configs[lastConfigIndex.current] : undefined;

  useEffect(() => {
    lastConfigIndex.current = historyIndex;
  }, [historyIndex]);

  return (
    <FullPageModal
      headerChildren={
        historyIndex !== undefined && (
          <>
            <div className="flex flex-row gap-1 items-center justify-center grow">
              {previousVersion ? (
                <button
                  onClick={() => {
                    setHistoryIndex(configs.length - 1);
                  }}
                  title="First Version"
                >
                  <OutlinedIcon
                    name="first_page"
                    className="text-lg!"
                  />
                </button>
              ) : (
                <OutlinedIcon
                  name="first_page"
                  className="text-lg! opacity-50"
                />
              )}
              <button
                onClick={() => {
                  previousVersion ? setHistoryIndex(historyIndex + 1) : setHistoryIndex(0);
                }}
                title="Previous Version"
              >
                <OutlinedIcon
                  name="keyboard_double_arrow_left"
                  className="text-lg!"
                />
              </button>
              <h2 className="whitespace-nowrap overflow-hidden text-ellipsis min-w-25 text-center">
                Revision {currentConfig?.revision}
              </h2>
              <button
                onClick={() => {
                  nextVersion ? setHistoryIndex(historyIndex - 1) : setHistoryIndex(configs.length - 1);
                }}
                title="Next Version"
              >
                <OutlinedIcon
                  name="keyboard_double_arrow_right"
                  className="text-lg!"
                />
              </button>
              {nextVersion ? (
                <button
                  onClick={() => {
                    setHistoryIndex(0);
                  }}
                  title="Last Version"
                >
                  <OutlinedIcon
                    name="last_page"
                    className="text-lg!"
                  />
                </button>
              ) : (
                <OutlinedIcon
                  name="last_page"
                  className="text-lg! opacity-50"
                />
              )}
            </div>
            <fieldset
              className="toggle-group"
              aria-label="View Type"
            >
              <ViewToggleButton
                name="isShowingJSON"
                checked={!isShowingJSON}
                onChange={() => {
                  setIsShowingJSON(false);
                }}
              >
                Details
              </ViewToggleButton>
              <ViewToggleButton
                name="isShowingJSON"
                checked={isShowingJSON}
                onChange={() => {
                  setIsShowingJSON(true);
                }}
              >
                JSON
              </ViewToggleButton>
            </fieldset>
          </>
        )
      }
      open={open}
      onClose={() => {
        lastConfigIndex.current = undefined;
        onClose();
      }}
    >
      {currentConfig && (
        <>
          <InlineBanner status="info">
            <p>
              Created by <strong>{currentConfig.username}</strong> on{" "}
              <strong>
                {currentConfig.created_at.toLocaleString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </strong>
              . {currentConfig.description}.
            </p>
            <div className="flex flex-row gap-1">
              {currentConfig.tags?.map((tag) => (
                <Tag
                  key={tag}
                  color={Colors.tag}
                >
                  {tag}
                </Tag>
              ))}
            </div>
          </InlineBanner>
          <ServiceConfigOverview
            serviceConfig={currentConfig.data}
            previousConfig={lastConfig?.data}
            isShowingJSON={isShowingJSON}
          />
        </>
      )}
    </FullPageModal>
  );
};
