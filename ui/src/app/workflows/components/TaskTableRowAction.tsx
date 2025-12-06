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
import { useRef } from "react";

import { Tag, TagSizes, Colors } from "~/components/Tag";
import { formatForWrapping } from "~/utils/string";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface TaskTableRowActionProps {
  id: string;
  name: string;
  retry_id: number | null;
  lead: boolean;
  selected: boolean;
  verbose?: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
  extraParams?: Record<string, string>;
}

export const TaskTableRowAction = ({
  id,
  name,
  retry_id,
  lead,
  selected,
  verbose,
  updateUrl,
  extraParams,
}: TaskTableRowActionProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      id={id}
      className={`btn ${selected ? "btn-primary disabled:opacity-100" : "btn-secondary"} relative border-gray-400 enabled:hover:border-black`}
      ref={buttonRef}
      onClick={() => {
        updateUrl({
          task: name,
          retry_id: retry_id,
          ...extraParams,
        });
      }}
    >
      {formatForWrapping(name)}
      {lead && (
        <Tag
          color={Colors.tag}
          className="tag-top tag-medium"
          size={TagSizes.xxs}
        >
          Lead
        </Tag>
      )}
      {verbose && retry_id !== null && (
        <Tag
          color={Colors.tag}
          className="tag-bottom tag-small"
          size={TagSizes.xxs}
        >
          {retry_id}
        </Tag>
      )}
    </button>
  );
};
