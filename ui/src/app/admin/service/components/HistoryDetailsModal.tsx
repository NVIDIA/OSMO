//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import { useMemo, useState } from "react";

import FullPageModal from "~/components/FullPageModal";
import { Select } from "~/components/Select";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import { type ServiceConfigHistoryItem } from "~/models/config/service-config";

import { ConfigChangeInfo } from "./ConfigChangeInfo";
import { useHistoryDetails } from "./HistoryDetailsContext";
import { ServiceConfigOverview } from "./ServiceConfigOverview";

interface HistoryDetailsModalProps {
  open: boolean;
  onClose: () => void;
  leftRevision: number;
  rightRevision: number;
  setLeftRevision: (index: number) => void;
  setRightRevision: (index: number) => void;
}

const RevisionSelector = ({
  id,
  value,
  onSelect,
}: {
  id: string;
  value: number;
  onSelect: (index: number) => void;
}) => {
  const { configs } = useHistoryDetails();

  // The -999px is to hide the text from the select element so that you only see the revision number.
  return (
    <Select
      className="w-full bg-headerbg border-none! font-bold"
      id={id}
      value={value.toString()}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
        onSelect(Number(e.target.value));
      }}
      slotLeft={<span className="font-bold">{`Revision ${value}`}</span>}
      style={{ textIndent: "-9999px" }}
    >
      {configs.map((config: ServiceConfigHistoryItem) => (
        <option
          key={config.revision}
          value={config.revision.toString()}
        >
          {`Revision ${config.revision}: ${config.description}`}
        </option>
      ))}
    </Select>
  );
};

export const HistoryDetailsModal = ({
  open,
  onClose,
  leftRevision,
  rightRevision,
  setLeftRevision,
  setRightRevision,
}: HistoryDetailsModalProps) => {
  const [isShowingJSON, setIsShowingJSON] = useState(false);
  const { configs } = useHistoryDetails();

  const currentConfig = useMemo(
    () => configs.find((config: ServiceConfigHistoryItem) => config.revision === rightRevision),
    [configs, rightRevision],
  );

  const previousVersion = useMemo(
    () => configs.find((config: ServiceConfigHistoryItem) => config.revision === leftRevision),
    [configs, leftRevision],
  );

  return (
    <FullPageModal
      headerChildren={
        <>
          <h2 className="grow">Service Config</h2>
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
      }
      open={open}
      onClose={() => {
        onClose();
      }}
    >
      {currentConfig && (
        <>
          <div className="grid grid-cols-2 gap-global p-global w-full grow">
            {previousVersion?.data && (
              <div className="flex flex-col card h-full w-full">
                <RevisionSelector
                  id="left-revision-selector"
                  value={leftRevision}
                  onSelect={setLeftRevision}
                />
                <ConfigChangeInfo config={previousVersion} />
                <ServiceConfigOverview
                  serviceConfig={previousVersion.data}
                  previousConfig={currentConfig.data}
                  isShowingJSON={isShowingJSON}
                />
              </div>
            )}
            <div className="flex flex-col card h-full w-full">
              <RevisionSelector
                id="right-revision-selector"
                value={rightRevision}
                onSelect={setRightRevision}
              />
              <ConfigChangeInfo config={currentConfig} />
              <ServiceConfigOverview
                serviceConfig={currentConfig.data}
                previousConfig={previousVersion?.data}
                isShowingJSON={isShowingJSON}
              />
            </div>
          </div>
        </>
      )}
    </FullPageModal>
  );
};
