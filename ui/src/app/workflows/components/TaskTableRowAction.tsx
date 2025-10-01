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
import { useRef, useEffect } from "react";

import { Tag, TagSizes, Colors } from "~/components/Tag";
import { formatForWrapping } from "~/utils/string";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface TaskTableRowActionProps {
  name: string;
  retry_id: number | null;
  lead: boolean;
  selected: boolean;
  verbose?: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
  extraParams?: Record<string, string>;
  disableScrollIntoView?: boolean;
}

export const TaskTableRowAction = ({
  name,
  retry_id,
  lead,
  selected,
  verbose,
  updateUrl,
  extraParams,
  disableScrollIntoView = false,
}: TaskTableRowActionProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (buttonRef.current && selected && !disableScrollIntoView) {
      buttonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selected, disableScrollIntoView]);

  return (
    <button
      className={`btn ${selected ? "btn-primary disabled:opacity-100" : "btn-secondary"} relative border-gray-400 enabled:hover:border-black`}
      ref={buttonRef}
      onClick={() => {
        updateUrl({
          task: name,
          retry_id: retry_id,
          selectedPool: null,
          selectedPlatform: null,
          ...extraParams,
        });
      }}
      disabled={selected}
    >
      {formatForWrapping(name)}
      {lead && (
        <Tag
          color={Colors.tag}
          className="pt-[1px]! px-[2px]! shadow-md z-10 absolute top-[-0.4rem] right-[-0.8rem] rounded-none!"
          size={TagSizes.xxs}
        >
          Lead
        </Tag>
      )}
      {verbose && retry_id !== null && (
        <Tag
          color={Colors.tag}
          className="pt-[1px]! px-[2px]! shadow-md z-10 absolute bottom-[-0.4rem] right-[-0.4rem] rounded-none!"
          size={TagSizes.xxs}
        >
          {retry_id}
        </Tag>
      )}
    </button>
  );
};
