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
interface PlatformDetailsProps {
  hostNetwork?: boolean | null;
  privileged?: boolean | null;
  defaultMounts?: string[] | null;
  allowedMounts?: string[] | null;
  className?: string;
}

export const PlatformDetails = ({
  hostNetwork,
  privileged,
  defaultMounts,
  allowedMounts,
  className = "",
}: PlatformDetailsProps) => {
  return (
    <div className={`w-full gap-4 ${className}`}>
      <div className="card p-0 overflow-y-auto">
        <h3
          className="body-header text-base px-3"
          id="task-configurations"
        >
          Configurations
        </h3>
        <dl
          aria-labelledby="task-configurations"
          className="p-3"
        >
          <dt>Host Network Allowed</dt>
          <dd>{hostNetwork ? "True" : "False"}</dd>
          <dt>Privileged Mode Allowed</dt>
          <dd>{privileged ? "True" : "False"}</dd>
        </dl>
      </div>
      <div className="card p-0 overflow-y-auto">
        <h3
          className="body-header text-base px-3"
          id="default-mounts"
        >
          Default Mounts
        </h3>
        <ul
          aria-labelledby="default-mounts"
          className="p-3"
        >
          {defaultMounts?.map((mount) => (
            <li key={mount}>{mount}</li>
          ))}
        </ul>
      </div>
      <div className="card p-0 overflow-y-auto">
        <h3
          className="body-header text-base px-3"
          id="allowed-mounts"
        >
          Allowed Mounts
        </h3>
        {allowedMounts?.length ? (
          <ul
            aria-labelledby="allowed-mounts"
            className="p-3"
          >
            {allowedMounts?.map((mount) => (
              <li key={mount}>{mount}</li>
            ))}
          </ul>
        ) : (
          <p className="p-3">No Available Allowed Mounts</p>
        )}
      </div>
    </div>
  );
};
