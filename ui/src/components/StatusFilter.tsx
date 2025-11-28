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
export enum StatusFilterType {
  ALL = "all",
  CURRENT = "current",
  COMPLETED = "completed",
  FAILED = "failed",
  CUSTOM = "custom",
}

export const StatusFilter = ({
  statusFilterType,
  setStatusFilterType,
}: {
  className?: string;
  statusFilterType?: StatusFilterType;
  setStatusFilterType: (statusFilterType: StatusFilterType) => void;
}) => {
  return (
    <fieldset className="flex flex-col gap-1 mb-2">
      <legend>Status</legend>
      <div className="flex flex-row gap-radios">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="statusFilterType"
            value={StatusFilterType.ALL}
            checked={statusFilterType === StatusFilterType.ALL}
            onChange={() => setStatusFilterType(StatusFilterType.ALL)}
          />
          All
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="statusFilterType"
            value={StatusFilterType.CURRENT}
            checked={statusFilterType === StatusFilterType.CURRENT}
            onChange={() => setStatusFilterType(StatusFilterType.CURRENT)}
          />
          Current
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="statusFilterType"
            value={StatusFilterType.COMPLETED}
            checked={statusFilterType === StatusFilterType.COMPLETED}
            onChange={() => setStatusFilterType(StatusFilterType.COMPLETED)}
          />
          Completed
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="statusFilterType"
            value={StatusFilterType.FAILED}
            checked={statusFilterType === StatusFilterType.FAILED}
            onChange={() => setStatusFilterType(StatusFilterType.FAILED)}
          />
          Failed
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="statusFilterType"
            value={StatusFilterType.CUSTOM}
            checked={statusFilterType === StatusFilterType.CUSTOM}
            onChange={() => setStatusFilterType(StatusFilterType.CUSTOM)}
          />
          Custom
        </label>
      </div>
    </fieldset>
  );
};
