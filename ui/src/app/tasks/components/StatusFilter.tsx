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
import { CheckboxWithLabel } from "~/components/Checkbox";
import { StatusFilter as StatusFilterCommon, StatusFilterType } from "~/components/StatusFilter";
import { TaskStatusValues, type TaskStatusType } from "~/models";

export const getMapFromStatusArray = (statusArray: string[]) => {
  return new Map(TaskStatusValues.map((value) => [value, statusArray.includes(value.toString())]));
};

export const getTaskStatusArray = (
  statusFilterType?: StatusFilterType,
  statusMap?: Map<TaskStatusType, boolean>,
): TaskStatusType[] => {
  if (statusFilterType === StatusFilterType.ALL) {
    return [...TaskStatusValues];
  }

  if (statusFilterType === StatusFilterType.CURRENT) {
    return ["SUBMITTING", "SCHEDULING", "WAITING", "PROCESSING", "INITIALIZING", "RUNNING"];
  }

  if (statusFilterType === StatusFilterType.COMPLETED) {
    return ["COMPLETED"];
  }

  if (statusFilterType === StatusFilterType.FAILED) {
    return TaskStatusValues.filter((status) => status.startsWith("FAILED")).concat(["RESCHEDULED"]);
  }

  if (!statusFilterType || !statusMap) {
    return [];
  }

  return Array.from(statusMap.entries())
    .filter(([_, enabled]) => enabled)
    .map(([status]) => status);
};

export const StatusFilter = ({
  statusMap,
  setStatusMap,
  className,
  statusFilterType,
  setStatusFilterType,
}: {
  statusMap: Map<TaskStatusType, boolean>;
  setStatusMap: (map: Map<TaskStatusType, boolean>) => void;
  className?: string;
  statusFilterType?: StatusFilterType;
  setStatusFilterType: (statusFilterType: StatusFilterType) => void;
}) => {
  return (
    <div className={className}>
      <StatusFilterCommon
        statusFilterType={statusFilterType}
        setStatusFilterType={setStatusFilterType}
      />
      {statusFilterType === StatusFilterType.CUSTOM &&
        TaskStatusValues.map((name) => {
          const checked = Boolean(statusMap.get(name));
          return (
            <CheckboxWithLabel
              key={name}
              label={name}
              checked={checked}
              containerClassName="p-1"
              onChange={(event) => {
                const newMap = new Map(statusMap);
                newMap.set(name, Boolean(event.target.checked));
                setStatusMap(newMap);
              }}
            />
          );
        })}
    </div>
  );
};
